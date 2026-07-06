import { NextRequest, NextResponse } from 'next/server'
import { generateDraftArticle } from '@/lib/draftGeneration'

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

    const { title, content, materialBinding } = await generateDraftArticle({
      prompt: promptStr,
      targetKeyword: targetKeywordStr,
      fileIds: ids,
      s3Keys: explicitS3Keys,
    })

    return NextResponse.json({ title, content, materialBinding })
  } catch (error) {
    console.error('Gemini draft API error:', error)
    const message =
      error instanceof Error ? error.message : '一次執筆の生成に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
