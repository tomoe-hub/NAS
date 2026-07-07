/**
 * GA4 / GSC / Clarity の一括同期。
 * NIS の run-sync.ts をS3ストア＋環境変数ベース（単一サイト）に書き換えたもの。
 *
 * 必要な環境変数:
 * - GOOGLE_SERVICE_ACCOUNT_JSON … GA4/GSC 共通のサービスアカウント
 * - GA4_PROPERTY_ID … GA4 プロパティID（数字のみ）
 * - GSC_PROPERTY_URL … Search Console プロパティ（例: https://nihon-teikei.co.jp/ または sc-domain:nihon-teikei.co.jp）
 * - CLARITY_API_TOKEN / CLARITY_PROJECT_ID … Microsoft Clarity Data Export API
 */
import { format, subDays } from 'date-fns'
import { fetchGa4DailyRows } from './ga4'
import { fetchGscDailyRows } from './gsc'
import { fetchClarityLiveInsights } from './clarity'
import { loadServiceAccountCredentials } from './googleCredentials'
import { loadSyncMeta, mergeClarityRows, mergeGa4Rows, mergeGscRows, saveSyncMeta } from './seoStore'
import type { SeoSyncResult, SeoSyncSourceResult } from './types'

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runSeoSync(opts?: { days?: number }): Promise<SeoSyncResult> {
  const days = Math.min(Math.max(opts?.days ?? 28, 1), 366)
  const end = format(new Date(), 'yyyy-MM-dd')
  const start = format(subDays(new Date(), days - 1), 'yyyy-MM-dd')
  const nowIso = new Date().toISOString()

  const ga4PropertyId = process.env.GA4_PROPERTY_ID?.trim()
  const gscPropertyUrl = process.env.GSC_PROPERTY_URL?.trim()
  const clarityToken = process.env.CLARITY_API_TOKEN?.trim()
  const credResult = loadServiceAccountCredentials()

  let ga4: SeoSyncSourceResult = { status: 'ok', count: 0 }
  let gsc: SeoSyncSourceResult = { status: 'ok', count: 0 }
  let clarity: SeoSyncSourceResult = { status: 'ok', count: 0 }

  const meta = await loadSyncMeta()

  /* ── GA4 / GSC ── */
  if (!credResult.ok) {
    ga4 = { status: 'skipped_missing_config', count: 0, error: credResult.message }
    gsc = { status: 'skipped_missing_config', count: 0, error: credResult.message }
  } else {
    if (!ga4PropertyId) {
      ga4 = { status: 'skipped_missing_config', count: 0, error: 'GA4_PROPERTY_ID が未設定です' }
    }
    if (!gscPropertyUrl) {
      gsc = { status: 'skipped_missing_config', count: 0, error: 'GSC_PROPERTY_URL が未設定です' }
    }

    const [ga4Result, gscResult] = await Promise.allSettled([
      ga4PropertyId
        ? fetchGa4DailyRows({ propertyId: ga4PropertyId, startDate: start, endDate: end })
        : Promise.resolve(null),
      gscPropertyUrl
        ? fetchGscDailyRows({ siteUrl: gscPropertyUrl, startDate: start, endDate: end })
        : Promise.resolve(null),
    ])

    if (ga4PropertyId) {
      if (ga4Result.status === 'fulfilled' && ga4Result.value) {
        try {
          await mergeGa4Rows(ga4Result.value)
          ga4 = { status: 'ok', count: ga4Result.value.length }
          meta.lastGa4SyncAt = nowIso
        } catch (e) {
          ga4 = { status: 'failed', count: 0, error: errMsg(e) }
        }
      } else if (ga4Result.status === 'rejected') {
        ga4 = { status: 'failed', count: 0, error: errMsg(ga4Result.reason) }
      }
    }

    if (gscPropertyUrl) {
      if (gscResult.status === 'fulfilled' && gscResult.value) {
        try {
          await mergeGscRows(gscResult.value)
          gsc = { status: 'ok', count: gscResult.value.length }
          meta.lastGscSyncAt = nowIso
        } catch (e) {
          gsc = { status: 'failed', count: 0, error: errMsg(e) }
        }
      } else if (gscResult.status === 'rejected') {
        gsc = { status: 'failed', count: 0, error: errMsg(gscResult.reason) }
      }
    }
  }

  /* ── Clarity ── */
  if (!clarityToken) {
    clarity = { status: 'skipped_missing_config', count: 0, error: 'CLARITY_API_TOKEN が未設定です' }
  } else {
    try {
      const rows = await fetchClarityLiveInsights({ token: clarityToken, numOfDays: 3 })
      await mergeClarityRows(rows)
      clarity = { status: 'ok', count: rows.length }
      meta.lastClaritySyncAt = nowIso
    } catch (e) {
      clarity = { status: 'failed', count: 0, error: errMsg(e) }
    }
  }

  const result: SeoSyncResult = { syncedAt: nowIso, days, ga4, gsc, clarity }

  if (ga4.status === 'ok' && gsc.status === 'ok') {
    meta.lastSyncAt = nowIso
  }
  meta.lastResult = result
  await saveSyncMeta(meta)

  return result
}
