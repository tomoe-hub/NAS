import { NextRequest, NextResponse } from 'next/server'
import {
  loadSiteAuditDocument,
  auditPage,
  generateSiteAuditOverall,
  DEFAULT_AUDIT_PAGES,
} from '@/lib/siteAudit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** GET /api/site-audit — 保存済みの診断結果とプリセットページ一覧を取得 */
export async function GET() {
  try {
    const doc = await loadSiteAuditDocument()
    return NextResponse.json({ doc, defaultPages: DEFAULT_AUDIT_PAGES })
  } catch (e) {
    console.error('[SiteAudit] GET error:', e)
    return NextResponse.json({ error: '診断結果の取得に失敗しました' }, { status: 500 })
  }
}

/**
 * POST /api/site-audit
 * - body: { action: 'page', url, label } — 1ページ診断（フロントが順次呼ぶ）
 * - body: { action: 'overall' } — ページ診断結果から総合サマリを生成
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))

    if (body?.action === 'overall') {
      const overall = await generateSiteAuditOverall()
      return NextResponse.json({ overall })
    }

    if (body?.action === 'page') {
      if (typeof body.url !== 'string' || !body.url) {
        return NextResponse.json({ error: 'url が必要です' }, { status: 400 })
      }
      const label = typeof body.label === 'string' && body.label ? body.label : body.url
      const result = await auditPage(body.url, label)
      return NextResponse.json({ result })
    }

    return NextResponse.json({ error: 'action は page または overall を指定してください' }, { status: 400 })
  } catch (e) {
    console.error('[SiteAudit] POST error:', e)
    const message = e instanceof Error ? e.message : '診断の実行に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
