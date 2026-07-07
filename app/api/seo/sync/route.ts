/**
 * POST /api/seo/sync
 *
 * GA4 / Search Console / Clarity のデータを取得してS3に保存する手動同期エンドポイント。
 * SEO分析ページの「データ同期」ボタンから呼ばれる。
 * body: { days?: number } … 遡り日数（初回は 90 など、通常は 28）
 */
import { NextRequest, NextResponse } from 'next/server'
import { runSeoSync } from '@/lib/seo/runSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  let days = 28
  try {
    const body = await request.json().catch(() => ({}))
    if (typeof body?.days === 'number') days = body.days
  } catch {
    /* body なしは既定値 */
  }

  try {
    const result = await runSeoSync({ days })
    return NextResponse.json(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'SEOデータの同期に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
