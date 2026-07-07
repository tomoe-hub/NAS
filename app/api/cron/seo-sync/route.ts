/**
 * GET /api/cron/seo-sync
 *
 * Vercel Cron から毎日 20:00 UTC（= JST 翌朝5:00）に呼ばれるSEOデータ自動同期。
 * GA4 / Search Console は過去28日分を再取得して upsert（GSCの2〜3日遅れ確定を自動で埋める）、
 * Clarity は直近3日間のライブスナップショットを保存する。
 *
 * 手動テスト: GET /api/cron/seo-sync（Authorization: Bearer <CRON_SECRET> が必要）
 */
import { NextRequest, NextResponse } from 'next/server'
import { runSeoSync } from '@/lib/seo/runSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  // middleware でも検証しているが、ルート側でも二重チェックする
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET が未設定です' }, { status: 500 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runSeoSync({ days: 28 })
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'SEOデータの自動同期に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
