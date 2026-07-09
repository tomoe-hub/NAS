import { NextRequest, NextResponse } from 'next/server'
import { loadAutoArticleSettings, saveAutoArticleSettings } from '@/lib/autoArticleSettings'

export const dynamic = 'force-dynamic'

/** GET /api/auto-article/settings — 自動記事生成の設定（ON/OFF・期間）を取得 */
export async function GET() {
  try {
    const settings = await loadAutoArticleSettings()
    return NextResponse.json(settings)
  } catch (e) {
    console.error('[AutoArticle Settings] GET error:', e)
    return NextResponse.json({ error: '設定の取得に失敗しました' }, { status: 500 })
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * POST /api/auto-article/settings
 * body: { enabled?: boolean, startDate?: string, endDate?: string }
 * startDate / endDate は "YYYY-MM-DD"。空文字 "" でクリア（未設定に戻す）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const update: { enabled?: boolean; startDate?: string; endDate?: string } = {}

    if (body?.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ error: 'enabled は boolean で指定してください' }, { status: 400 })
      }
      update.enabled = body.enabled
    }

    for (const key of ['startDate', 'endDate'] as const) {
      const v = body?.[key]
      if (v === undefined) continue
      if (typeof v !== 'string' || (v !== '' && !ISO_DATE.test(v))) {
        return NextResponse.json({ error: `${key} は YYYY-MM-DD 形式か空文字で指定してください` }, { status: 400 })
      }
      update[key] = v
    }

    if (update.startDate && update.endDate && update.startDate > update.endDate) {
      return NextResponse.json({ error: '開始日は終了日以前にしてください' }, { status: 400 })
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: '更新項目がありません' }, { status: 400 })
    }

    const settings = await saveAutoArticleSettings(update)
    return NextResponse.json(settings)
  } catch (e) {
    console.error('[AutoArticle Settings] POST error:', e)
    const message = e instanceof Error ? e.message : '設定の保存に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
