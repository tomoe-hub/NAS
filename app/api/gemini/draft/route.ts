import { NextRequest, NextResponse } from 'next/server'
import { generateFirstDraftFromPrompt } from '@/lib/api/gemini'
import {
  buildMaterialsDataContextForDraft,
  getDraftMaterialsPrefix,
  resolveDraftS3Keys,
} from '@/lib/draftMaterialsContext'
import { embedText, findSimilarArticles } from '@/lib/articleEmbeddings'

/** 429 時の待機＋再生成を含められるよう長めに（プランにより上限は異なります） */
export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const { prompt, targetKeyword, fileIds, s3Keys } = await request.json()
    const promptStr = typeof prompt === 'string' ? prompt.trim() : ''
    const targetKeywordStr = typeof targetKeyword === 'string' ? targetKeyword.trim() || undefined : undefined
    const ids = Array.isArray(fileIds) ? fileIds.filter((id): id is string => typeof id === 'string') : []
    const explicitS3Keys = Array.isArray(s3Keys) ? s3Keys.filter((k): k is string => typeof k === 'string') : []
    const materialsPrefix = getDraftMaterialsPrefix()
    const allKeys = await resolveDraftS3Keys(explicitS3Keys, materialsPrefix)

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

    const { dataContext, binding } = await buildMaterialsDataContextForDraft(ids, allKeys)

    // 過去記事から文体・トーン参考を検索（失敗しても生成を止めない）
    let toneExamples: string | undefined
    try {
      const queryText = `${promptStr} ${targetKeywordStr ?? ''}`
      const queryVec = await embedText(queryText)
      const similar = await findSimilarArticles(queryVec, 3)
      if (similar.length > 0) {
        toneExamples = similar
          .map((a, i) => `--- 参考記事${i + 1}：${a.title}${a.keyword ? `（KW: ${a.keyword}）` : ''} ---\n${a.excerpt}`)
          .join('\n\n')
      }
    } catch (e) {
      console.warn('[Embedding] 類似記事の取得をスキップ（通常生成へフォールバック）:', e)
    }

    const { title, content } = await generateFirstDraftFromPrompt(
      promptStr,
      targetKeywordStr,
      dataContext || undefined,
      toneExamples,
    )
    return NextResponse.json({ title, content, materialBinding: binding })
  } catch (error) {
    console.error('Gemini draft API error:', error)
    const message =
      error instanceof Error ? error.message : '一次執筆の生成に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
