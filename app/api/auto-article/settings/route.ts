import { NextRequest, NextResponse } from 'next/server'
import { loadAutoArticleSettings, saveAutoArticleSettings } from '@/lib/autoArticleSettings'

export const dynamic = 'force-dynamic'

/** GET /api/auto-article/settings — 自動記事生成のON/OFF状態を取得 */
export async function GET() {
  try {
    const settings = await loadAutoArticleSettings()
    return NextResponse.json(settings)
  } catch (e) {
    console.error('[AutoArticle Settings] GET error:', e)
    return NextResponse.json({ error: '設定の取得に失敗しました' }, { status: 500 })
  }
}

/** POST /api/auto-article/settings — { enabled: boolean } で切り替え */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (typeof body?.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled（boolean）が必要です' }, { status: 400 })
    }
    const settings = await saveAutoArticleSettings(body.enabled)
    return NextResponse.json(settings)
  } catch (e) {
    console.error('[AutoArticle Settings] POST error:', e)
    const message = e instanceof Error ? e.message : '設定の保存に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
