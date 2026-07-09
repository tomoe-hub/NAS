import { NextRequest, NextResponse } from 'next/server'
import { loadSeoAiReport, loadSeoAiHistory, generateSeoAiReport } from '@/lib/seo/aiAnalysis'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** GET /api/seo/ai-analysis — 保存済みのAI分析レポートと履歴を取得 */
export async function GET() {
  try {
    const [report, history] = await Promise.all([loadSeoAiReport(), loadSeoAiHistory()])
    return NextResponse.json({ report, history })
  } catch (e) {
    console.error('[SEO AI] GET error:', e)
    return NextResponse.json({ error: 'AI分析レポートの取得に失敗しました' }, { status: 500 })
  }
}

/** POST /api/seo/ai-analysis — AI分析を実行してレポートを生成・保存（body: { range? }） */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const report = await generateSeoAiReport(typeof body?.range === 'string' ? body.range : undefined)
    return NextResponse.json({ report })
  } catch (e) {
    console.error('[SEO AI] POST error:', e)
    const message = e instanceof Error ? e.message : 'AI分析の実行に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
