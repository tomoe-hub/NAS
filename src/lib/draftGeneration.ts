/**
 * 一次執筆パイプライン（RAGコンテキスト組み立て + Gemini 生成）。
 *
 * /api/gemini/draft（エディタからの手動生成）と
 * /api/cron/auto-article（自動生成）の両方から呼ばれる共通実装。
 */

import { generateFirstDraftFromPrompt } from '@/lib/api/gemini'
import {
  buildMaterialsDataContextForDraft,
  getDraftMaterialsPrefix,
  resolveDraftS3Keys,
} from '@/lib/draftMaterialsContext'
import type { DraftMaterialBinding } from '@/lib/draftMaterialsContext'
import { embedText, findSimilarArticles, findArticlesByKeyword } from '@/lib/articleEmbeddings'
import {
  findRelevantMaterialChunks,
  buildMaterialContextFromChunks,
  autoEmbedNewMaterials,
} from '@/lib/materialEmbeddings'
import { findKeywordInLatestDataset, buildCompetitorContext } from '@/lib/ahrefsLoader'

export interface GenerateDraftOptions {
  prompt: string
  targetKeyword: string
  /** ローカルアップロード資料のID（手動生成時のみ） */
  fileIds?: string[]
  /** 明示指定されたS3キー（手動生成時のみ） */
  s3Keys?: string[]
}

export interface GenerateDraftResult {
  title: string
  content: string
  materialBinding: DraftMaterialBinding | null
}

/**
 * RAG（資料・過去記事・競合データ）コンテキストを組み立てて一次執筆を実行する。
 */
export async function generateDraftArticle(
  options: GenerateDraftOptions,
): Promise<GenerateDraftResult> {
  const { prompt, targetKeyword } = options
  const ids = options.fileIds ?? []
  const explicitS3Keys = options.s3Keys ?? []

  // ────────────────────────────────────────────────────────
  // Embedding: クエリベクトルを先に生成（資料RAG + 記事RAGで共用）
  // ────────────────────────────────────────────────────────
  let queryVec: number[] | null = null
  try {
    queryVec = await embedText(`${prompt} ${targetKeyword}`)
  } catch (e) {
    console.warn('[Draft] クエリベクトル生成失敗（通常生成へフォールバック）:', e)
  }

  // S3 に新しい資料が追加されていれば生成前に自動でベクトル化する。
  // 既処理ファイルはスキップされるため、ほぼオーバーヘッドなし。
  await autoEmbedNewMaterials()

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
          const uploaded = await buildMaterialsDataContextForDraft(ids, [])
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
  // 同一KWの過去記事は類似度検索と別枠で必ず拾い、内容重複を確実に防ぐ
  // ────────────────────────────────────────────────────────
  let toneExamples: string | undefined
  let avoidHeadings: string | undefined
  try {
    const [similar, sameKw] = await Promise.all([
      queryVec ? findSimilarArticles(queryVec, 3) : Promise.resolve([]),
      findArticlesByKeyword(targetKeyword, 3),
    ])

    // 類似記事＋同一KW記事をID重複なしで統合（同一KWを先頭に置き優先度を上げる）
    const seen = new Set<string>()
    const merged = [...sameKw, ...similar].filter(a => {
      if (seen.has(a.id)) return false
      seen.add(a.id)
      return true
    })

    if (merged.length > 0) {
      toneExamples = merged
        .map((a, i) => `--- 参考記事${i + 1}：${a.title}${a.keyword ? `（KW: ${a.keyword}）` : ''} ---\n${a.excerpt}`)
        .join('\n\n')

      const sameKwIds = new Set(sameKw.map(a => a.id))
      const headingBlocks = merged
        .filter(a => a.headings.length > 0)
        .map((a, i) => {
          const label = sameKwIds.has(a.id)
            ? `【同一KWの過去記事・重複厳禁】「${a.title}」の見出し:`
            : `参考記事${i + 1}「${a.title}」の見出し:`
          return `${label}\n${a.headings.map(h => `- ${h}`).join('\n')}`
        })
      if (headingBlocks.length > 0) {
        avoidHeadings = headingBlocks.join('\n\n')
      }

      // 同一KW記事は本文抜粋も「重複禁止コンテキスト」として明示する
      if (sameKw.length > 0) {
        const dupBlock = sameKw
          .map(a => `【同一KW過去記事「${a.title}」の冒頭】\n${a.excerpt}`)
          .join('\n\n')
        avoidHeadings = avoidHeadings
          ? `${avoidHeadings}\n\n${dupBlock}`
          : dupBlock
        console.log(`[Draft] 同一KW過去記事 ${sameKw.length} 件を重複禁止コンテキストに追加`)
      }
    }
  } catch (e) {
    console.warn('[Draft] 類似記事の取得をスキップ（通常生成へフォールバック）:', e)
  }

  // ────────────────────────────────────────────────────────
  // 競合分析コンテキスト: Ahrefsデータから対象KWを検索
  // ────────────────────────────────────────────────────────
  let competitorContext: string | undefined
  try {
    const ahrefsRow = await findKeywordInLatestDataset(targetKeyword)
    if (ahrefsRow) {
      competitorContext = buildCompetitorContext(targetKeyword, ahrefsRow)
      console.log(`[Draft] 競合データ取得: KW="${targetKeyword}" 順位=${ahrefsRow.position ?? '圏外'}`)
    }
  } catch (e) {
    console.warn('[Draft] Ahrefs競合データ取得をスキップ:', e)
  }

  const { title, content } = await generateFirstDraftFromPrompt(
    prompt,
    targetKeyword,
    dataContext || undefined,
    toneExamples,
    avoidHeadings,
    competitorContext,
  )

  return { title, content, materialBinding: binding }
}
