import type { ClarityDailyRow } from './types'

type ClarityMetricEntry = { metricName: string; information?: unknown[] }

function num(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pickMetric(entries: ClarityMetricEntry[], names: string[]): ClarityMetricEntry | undefined {
  for (const n of names) {
    const e = entries.find(x => x.metricName === n)
    if (e) return e
  }
  return undefined
}

function firstInfo(entries: ClarityMetricEntry[], names: string[]): Record<string, unknown> | undefined {
  const m = pickMetric(entries, names)
  const info = m?.information?.[0]
  return info && typeof info === 'object' ? (info as Record<string, unknown>) : undefined
}

function allInfo(entries: ClarityMetricEntry[], names: string[]): Array<Record<string, unknown>> {
  const m = pickMetric(entries, names)
  return ((m?.information ?? []) as Array<Record<string, unknown>>).filter(
    x => x && typeof x === 'object',
  )
}

function visitsFromRow(row: Record<string, unknown>): number {
  return num(
    row.visitsCount ??
      row.totalSessionCount ??
      row.sessionCount ??
      row.count ??
      row.Traffic ??
      row.subTotal,
  )
}

function urlOfRow(row: Record<string, unknown>): string {
  return String(row.URL ?? row.Url ?? row.url ?? '')
}

/**
 * Clarity Data Export API を1回呼ぶ。dimensions で内訳軸（最大3つ）を指定できる。
 * 注意: このAPIはプロジェクトあたり1日10リクエストまでの制限がある。
 */
async function callClarityApi(
  token: string,
  numOfDays: 1 | 2 | 3,
  dimensions: string[] = [],
): Promise<ClarityMetricEntry[]> {
  const url = new URL('https://www.clarity.ms/export-data/api/v1/project-live-insights')
  url.searchParams.set('numOfDays', String(numOfDays))
  dimensions.forEach((d, i) => url.searchParams.set(`dimension${i + 1}`, d))

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Clarity API ${res.status}: ${text.slice(0, 200)}`)
  }

  const json = await res.json()
  return Array.isArray(json) ? (json as ClarityMetricEntry[]) : []
}

/** dimension付きレスポンスから「URL等のキー → 指標値」のマップを作る */
function metricMapBy(
  entries: ClarityMetricEntry[],
  metricNames: string[],
  keyOf: (row: Record<string, unknown>) => string,
  valueOf: (row: Record<string, unknown>) => number,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of allInfo(entries, metricNames)) {
    const key = keyOf(row)
    if (!key) continue
    out.set(key, valueOf(row))
  }
  return out
}

/**
 * Clarity のライブ集計スナップショットを取得する。
 * 内訳（ページ別・参照元・ブラウザ別）を取るため最大4回APIを呼ぶ:
 *   1. dimensionなし … サイト全体サマリ
 *   2. dimension1=URL … ページ別（訪問・スクロール深度・Dead/Rageクリック）
 *   3. dimension1=Source … 参照元別
 *   4. dimension1=Browser&dimension2=Device&dimension3=OS … ブラウザ/端末別
 * 内訳呼び出しが失敗してもサマリだけで続行する（APIは1日10回制限のため429もあり得る）。
 */
export async function fetchClarityLiveInsights(opts: {
  token: string
  numOfDays: 1 | 2 | 3
}): Promise<ClarityDailyRow[]> {
  const { token, numOfDays } = opts

  const [summaryR, byUrlR, bySourceR, byBrowserR] = await Promise.allSettled([
    callClarityApi(token, numOfDays),
    callClarityApi(token, numOfDays, ['URL']),
    callClarityApi(token, numOfDays, ['Source']),
    callClarityApi(token, numOfDays, ['Browser', 'Device', 'OS']),
  ])

  // サマリが取れなければ全体を失敗として扱う
  if (summaryR.status === 'rejected') throw summaryR.reason
  const entries = summaryR.value
  if (entries.length === 0) return []

  const byUrl = byUrlR.status === 'fulfilled' ? byUrlR.value : []
  const bySource = bySourceR.status === 'fulfilled' ? bySourceR.value : []
  const byBrowser = byBrowserR.status === 'fulfilled' ? byBrowserR.value : []

  const dead = firstInfo(entries, ['Dead Click Count', 'DeadClickCount'])
  const rage = firstInfo(entries, ['Rage Click Count', 'RageClickCount'])
  const scrollInfo = firstInfo(entries, ['Scroll Depth', 'ScrollDepth'])
  const trafficInfo = firstInfo(entries, ['Traffic'])
  const engInfo = firstInfo(entries, ['Engagement Time', 'EngagementTime'])
  const scriptErr = firstInfo(entries, ['Script Error Count', 'ScriptErrorCount'])
  const quickback = firstInfo(entries, ['Quickback Click', 'QuickbackClick', 'QuickbackCount'])
  const excessive = firstInfo(entries, ['Excessive Scroll', 'ExcessiveScroll', 'ExcessiveScrollCount'])

  const totalSessions = num(trafficInfo?.totalSessionCount ?? dead?.sessionsCount)
  const totalBots = num(trafficInfo?.totalBotSessionCount)
  const avgScrollDepth = num(scrollInfo?.averageScrollDepth)
  const activeTime = num(
    engInfo?.activeTime ?? engInfo?.engagementTime ?? engInfo?.totalEngagementTime,
  )
  const today = new Date().toISOString().slice(0, 10)

  const distinctUsers = num(
    trafficInfo?.distinctUserCount ?? trafficInfo?.distantUserCount ?? trafficInfo?.DistinctUserCount,
  )
  const pagesPerSession = num(trafficInfo?.PagesPerSessionPercentage ?? trafficInfo?.pagesPerSession)
  const totalPageviews = num(trafficInfo?.totalPageviewCount ?? trafficInfo?.totalPageViewCount)

  const rows: ClarityDailyRow[] = []

  rows.push({
    sk: `${today}#(project-summary)`,
    date: today,
    sourceWindowDays: numOfDays,
    rowKind: 'summary',
    url: '(project-summary)',
    traffic: totalSessions,
    engagementTime: activeTime,
    scrollDepth: avgScrollDepth,
    deadClickCount: num(dead?.subTotal),
    rageClickCount: num(rage?.subTotal),
    scriptErrorCount: num(scriptErr?.subTotal),
    quickbackCount: num(quickback?.subTotal ?? quickback?.quickbackCount),
    excessiveScrollCount: num(excessive?.subTotal ?? excessive?.excessiveScrollCount),
    totalPageviews: totalPageviews || undefined,
    distinctUsers: distinctUsers || undefined,
    pagesPerSession: pagesPerSession || undefined,
    botSessionCount: totalBots || undefined,
  })

  /* ── ページ別（dimension1=URL）── */
  if (byUrl.length > 0) {
    const trafficBy = metricMapBy(byUrl, ['Traffic'], urlOfRow, visitsFromRow)
    const scrollBy = metricMapBy(byUrl, ['Scroll Depth', 'ScrollDepth'], urlOfRow, r =>
      num(r.averageScrollDepth ?? r.scrollDepth),
    )
    const engBy = metricMapBy(byUrl, ['Engagement Time', 'EngagementTime'], urlOfRow, r =>
      num(r.activeTime ?? r.engagementTime ?? r.totalEngagementTime),
    )
    const deadBy = metricMapBy(byUrl, ['Dead Click Count', 'DeadClickCount'], urlOfRow, r => num(r.subTotal))
    const rageBy = metricMapBy(byUrl, ['Rage Click Count', 'RageClickCount'], urlOfRow, r => num(r.subTotal))
    const scriptBy = metricMapBy(byUrl, ['Script Error Count', 'ScriptErrorCount'], urlOfRow, r => num(r.subTotal))
    const quickBy = metricMapBy(byUrl, ['Quickback Click', 'QuickbackClick'], urlOfRow, r => num(r.subTotal))
    const excessBy = metricMapBy(byUrl, ['Excessive Scroll', 'ExcessiveScroll'], urlOfRow, r => num(r.subTotal))

    const urls = new Set<string>([...trafficBy.keys(), ...scrollBy.keys(), ...deadBy.keys(), ...rageBy.keys()])
    for (const rawUrl of urls) {
      const pageUrl = rawUrl.replaceAll('#', '_')
      if (!pageUrl) continue
      rows.push({
        sk: `${today}#p#${pageUrl.slice(0, 400)}`,
        date: today,
        rowKind: 'page',
        url: pageUrl,
        traffic: trafficBy.get(rawUrl) ?? 0,
        engagementTime: engBy.get(rawUrl) ?? 0,
        scrollDepth: scrollBy.get(rawUrl) ?? 0,
        deadClickCount: deadBy.get(rawUrl) ?? 0,
        rageClickCount: rageBy.get(rawUrl) ?? 0,
        scriptErrorCount: scriptBy.get(rawUrl) ?? 0,
        quickbackCount: quickBy.get(rawUrl) ?? 0,
        excessiveScrollCount: excessBy.get(rawUrl) ?? 0,
      })
    }
  } else {
    // フォールバック: dimensionなしレスポンスの Popular Pages（訪問数のみ）
    for (const p of allInfo(entries, ['Popular Pages', 'PopularPages'])) {
      const pageUrl = String(p.url ?? p.URL ?? '(unknown)').replaceAll('#', '_')
      rows.push({
        sk: `${today}#p#${pageUrl.slice(0, 400)}`,
        date: today,
        rowKind: 'page',
        url: pageUrl,
        traffic: visitsFromRow(p),
        engagementTime: num(p.activeTime ?? p.engagementTime),
        scrollDepth: num(p.averageScrollDepth ?? p.scrollDepth),
        deadClickCount: num(p.deadClickCount ?? p.DeadClickCount),
        rageClickCount: num(p.rageClickCount ?? p.RageClickCount),
        scriptErrorCount: num(p.scriptErrorCount ?? p.ScriptErrorCount),
        quickbackCount: num(p.quickbackCount),
        excessiveScrollCount: num(p.excessiveScrollCount),
      })
    }
  }

  /* ── 参照元別（dimension1=Source）── */
  const sourceRows = bySource.length > 0
    ? allInfo(bySource, ['Traffic'])
    : allInfo(entries, ['Referrer URL', 'Referrers', 'Referrer'])
  for (const ref of sourceRows) {
    const label = String(
      ref.Source ?? ref.source ?? ref.url ?? ref.URL ?? ref.ReferrerURL ?? ref.referrer ?? ref.Referrer ?? '(direct)',
    )
    const visits = visitsFromRow(ref)
    if (visits <= 0) continue
    rows.push({
      sk: `${today}#r#${label.replaceAll('#', '_').slice(0, 300)}`,
      date: today,
      rowKind: 'referrer',
      referrer: label,
      url: undefined,
      traffic: visits,
      engagementTime: 0,
      scrollDepth: 0,
      deadClickCount: 0,
      rageClickCount: 0,
      scriptErrorCount: 0,
    })
  }

  /* ── ブラウザ/端末別（dimension1=Browser&dimension2=Device&dimension3=OS）── */
  const browserSrc = byBrowser.length > 0 ? byBrowser : entries
  const browserRows = allInfo(browserSrc, ['Traffic']).filter(b => b.Browser ?? b.browser)
  const fallbackBrowserRows = browserRows.length > 0 ? browserRows : allInfo(entries, ['Browser'])
  const seen = new Map<string, { browser: string; device: string; os: string; visits: number }>()
  for (const b of fallbackBrowserRows) {
    const browser = String(b.Browser ?? b.browser ?? '')
    const device = String(b.Device ?? b.device ?? '')
    const os = String(b.OS ?? b.Os ?? b.os ?? '')
    const visits = visitsFromRow(b)
    if (visits <= 0) continue
    const label = browser || device
    if (!label) continue
    // ブラウザ名で集約（Device×OS のクロス積を潰す）
    const cur = seen.get(label)
    if (cur) {
      cur.visits += visits
    } else {
      seen.set(label, { browser: browser || device, device: device || browser, os, visits })
    }
  }
  for (const [label, v] of seen) {
    rows.push({
      sk: `${today}#b#${label.replaceAll('#', '_').slice(0, 120)}`,
      date: today,
      rowKind: 'device',
      clarityBrowser: v.browser,
      clarityDevice: v.device,
      clarityOs: v.os,
      traffic: v.visits,
      engagementTime: 0,
      scrollDepth: 0,
      deadClickCount: 0,
      rageClickCount: 0,
      scriptErrorCount: 0,
    })
  }

  return rows
}

export function clarityDashboardUrl(clarityProjectId: string) {
  return `https://clarity.microsoft.com/projects/view/${clarityProjectId}/`
}
