/**
 * GET /api/seo/metrics?range=7d|28d|90d
 *
 * S3に蓄積したGA4/GSC/Clarityデータを集計し、
 * SEO分析ダッシュボード用のバンドル（KPI・時系列・テーブル）を返す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildSeoDashboardData } from '@/lib/seo/aggregate'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const range = request.nextUrl.searchParams.get('range')
    const data = await buildSeoDashboardData(range)
    return NextResponse.json(data)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'SEOメトリクスの取得に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
