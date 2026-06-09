import { NextRequest, NextResponse } from 'next/server'
import { generateFirstDraftFromPrompt } from '@/lib/api/gemini'
import {
  buildMaterialsDataContextForDraft,
  getDraftMaterialsPrefix,
  resolveDraftS3Keys,
} from '@/lib/draftMaterialsContext'
import type { DraftMaterialBinding } from '@/lib/draftMaterialsContext'
import { embedText, findSimilarArticles } from '@/lib/articleEmbeddings'
import {
  findRelevantMaterialChunks,
  buildMaterialContextFromChunks,
} from '@/lib/materialEmbeddings'
import { findKeywordInLatestDataset, buildCompetitorContext } from '@/lib/ahrefsLoader'

/** 429 時の待機＋再生成を含められるよう長めに（プランにより上限は異なります） */
export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const { prompt, targetKeyword, fileIds, s3Keys } = await request.json()
    const promptStr = typeof prompt === 'string' ? prompt.trim() : ''
    const targetKeywordStr = typeof targetKeyword === 'string' ? targetKeyword.trim() || undefined : undefined
    const ids = Array.isArray(fileIds) ? fileIds.filter((id): id is string => typeof id === 'string') : []
    const explicitS3Keys = Array.isArray(s3Keys) ? s3Keys.filter((k): k is string => typeof k === 'string') : []

    if (!promptStr) {
      return NextResponse.json(
        { error: 'プロンプトを入力してください' },
        { status: 400 }
      )
    }

    if (!targetKeywordStr) {
      return NextResponse.json(
        { error: 'ターゲットキーワードは必須です。必ず設定してください。' },
        { status: 400 }
      )
    }

    // ────────────────────────────────────────────────────────
    // Embedding: クエリベクトルを先に生成（資料RAG + 記事RAGで共用）
    // ────────────────────────────────────────────────────────
    let queryVec: number[] | null = null
    try {
      queryVec = await embedText(`${promptStr} ${targetKeywordStr}`)
    } catch (e) {
      console.warn('[Draft] クエリベクトル生成失敗（通常生成へフォールバック）:', e)
    }

    // ────────────────────────────────────────────────────────
    // 資料コンテキスト: まず資料RAG（インデックスあり）を試み、
    // なければ従来のランダムウィンドウ方式にフォールバック
    // ────────────────────────────────────────────────────────
    let dataContext = ''
    let binding: DraftMaterialBinding | null = null
    let ragChunkIds: string[] | undefined

    if (queryVec) {
      try {
        const relevantChunks = await findRelevantMaterialChunks(queryVec, {
          generalK: 15,
          caseK: 5,
        })

        if (relevantChunks.length > 0) {
          // RAGモードで資料コンテキストを構築
          const ragContext = buildMaterialContextFromChunks(relevantChunks)
          ragChunkIds = relevantChunks.map(c => c.id)

          // アップロードファイルがある場合は先頭に追加（手動選択なのでRAG不要）
          let uploadContext = ''
          if (ids.length > 0) {
            const { buildMaterialsDataContextForDraft: buildUpload } = await import('@/lib/draftMaterialsContext')
            const uploaded = await buildUpload(ids, [])
            uploadContext = uploaded.dataContext
          }

          dataContext = uploadContext.trim()
            ? `${uploadContext}\n\n${ragContext}`
            : ragContext

          // bindingにRAGチャンクIDを記録（推敲時の再構築用）
          binding = {
            version: 1,
            fileIds: ids,
            s3Keys: [],
            windowStart: 0,
            contextLimit: dataContext.length,
            originalLen: dataContext.length,
            wasTruncated: false,
            ragChunkIds,
          }

          console.log(`[Draft] 資料RAG: ${relevantChunks.length}チャンク選択 (${dataContext.length}字)`)
        }
      } catch (e) {
        console.warn('[Draft] 資料RAG 失敗、ランダムウィンドウにフォールバック:', e)
      }
    }

    // RAGが使えなかった場合は従来方式
    if (!ragChunkIds) {
      const materialsPrefix = getDraftMaterialsPrefix()
      const allKeys = await resolveDraftS3Keys(explicitS3Keys, materialsPrefix)
      const built = await buildMaterialsDataContextForDraft(ids, allKeys)
      dataContext = built.dataContext
      binding = built.binding
    }

    // ────────────────────────────────────────────────────────
    // 過去記事 Embedding RAG: 文体参考 + 見出し差別化
    // ────────────────────────────────────────────────────────
    let toneExamples: string | undefined
    let avoidHeadings: string | undefined
    if (queryVec) {
      try {
        const similar = await findSimilarArticles(queryVec, 3)
        if (similar.length > 0) {
          toneExamples = similar
            .map((a, i) => `--- 参考記事${i + 1}：${a.title}${a.keyword ? `（KW: ${a.keyword}）` : ''} ---\n${a.excerpt}`)
            .join('\n\n')

          const headingBlocks = similar
            .filter(a => a.headings.length > 0)
            .map((a, i) => `参考記事${i + 1}「${a.title}」の見出し:\n${a.headings.map(h => `- ${h}`).join('\n')}`)
          if (headingBlocks.length > 0) {
            avoidHeadings = headingBlocks.join('\n\n')
          }
        }
      } catch (e) {
        console.warn('[Draft] 類似記事の取得をスキップ（通常生成へフォールバック）:', e)
      }
    }

    // ────────────────────────────────────────────────────────
    // 競合分析コンテキスト: Ahrefsデータから対象KWを検索
    // ────────────────────────────────────────────────────────
    let competitorContext: string | undefined
    try {
      const ahrefsRow = await findKeywordInLatestDataset(targetKeywordStr)
      if (ahrefsRow) {
        competitorContext = buildCompetitorContext(targetKeywordStr, ahrefsRow)
        console.log(`[Draft] 競合データ取得: KW="${targetKeywordStr}" 順位=${ahrefsRow.position ?? '圏外'}`)
      }
    } catch (e) {
      console.warn('[Draft] Ahrefs競合データ取得をスキップ:', e)
    }

    const { title, content } = await generateFirstDraftFromPrompt(
      promptStr,
      targetKeywordStr,
      dataContext || undefined,
      toneExamples,
      avoidHeadings,
      competitorContext,
    )
    return NextResponse.json({ title, content, materialBinding: binding })
  } catch (error) {
    console.error('Gemini draft API error:', error)
    const message =
      error instanceof Error ? error.message : '一次執筆の生成に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
