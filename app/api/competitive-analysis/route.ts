import { NextRequest, NextResponse } from 'next/server'
import {
  analyzeCompetitor,
  buildKeywordOpportunities,
  DEFAULT_COMPETITORS,
  generateCompetitiveStrategy,
  getAhrefsUsage,
  loadCompetitiveAnalysis,
  loadCompetitiveHistory,
  loadCompetitorConfig,
  refreshCompetitorKeywords,
  saveCompetitorConfig,
  type CompetitorConfig,
  type CompetitorUrl,
} from '@/lib/competitiveAnalysis'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** 現在の競合設定・分析結果・履歴・KW機会を返す */
export async function GET() {
  try {
    const [config, document, history, usage] = await Promise.all([
      loadCompetitorConfig(),
      loadCompetitiveAnalysis(),
      loadCompetitiveHistory(),
      getAhrefsUsage(),
    ])
    const opportunities = await buildKeywordOpportunities(document)
    return NextResponse.json({ config, document, history, opportunities, usage, defaults: DEFAULT_COMPETITORS })
  } catch (error) {
    console.error('[CompetitiveAnalysis] GET error:', error)
    return NextResponse.json({ error: '競合分析データの取得に失敗しました' }, { status: 500 })
  }
}

/**
 * action:
 * - save-config: 競合の設定を保存
 * - analyze-competitor: 公式ページ収集＋5軸分析
 * - refresh-keywords: Ahrefsから競合KWを取得
 * - generate-strategy: 第3段階の統合戦略提案
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      action?: string
      config?: CompetitorConfig[]
      competitorId?: string
      pages?: CompetitorUrl[]
    }

    if (body.action === 'save-config') {
      if (!Array.isArray(body.config)) {
        return NextResponse.json({ error: 'config が必要です' }, { status: 400 })
      }
      await saveCompetitorConfig(body.config)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'analyze-competitor') {
      if (!body.competitorId) {
        return NextResponse.json({ error: 'competitorId が必要です' }, { status: 400 })
      }
      const result = await analyzeCompetitor(body.competitorId, body.pages)
      return NextResponse.json({ result })
    }

    if (body.action === 'refresh-keywords') {
      if (!body.competitorId) {
        return NextResponse.json({ error: 'competitorId が必要です' }, { status: 400 })
      }
      const result = await refreshCompetitorKeywords(body.competitorId)
      return NextResponse.json({ result })
    }

    if (body.action === 'generate-strategy') {
      const report = await generateCompetitiveStrategy()
      return NextResponse.json({ report })
    }

    return NextResponse.json({ error: '未知の action です' }, { status: 400 })
  } catch (error) {
    console.error('[CompetitiveAnalysis] POST error:', error)
    const message = error instanceof Error ? error.message : '競合分析の実行に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
