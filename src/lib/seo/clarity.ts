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

/**
 * Clarity Data Export API（project-live-insights）から
 * 直近 numOfDays 日間のライブ集計スナップショットを取得する。
 */
export async function fetchClarityLiveInsights(opts: {
  token: string
  numOfDays: 1 | 2 | 3
}): Promise<ClarityDailyRow[]> {
  const url = new URL('https://www.clarity.ms/export-data/api/v1/project-live-insights')
  url.searchParams.set('numOfDays', String(opts.numOfDays))

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Clarity API ${res.status}: ${text.slice(0, 200)}`)
  }

  const json = await res.json()
  const entries: ClarityMetricEntry[] = Array.isArray(json) ? json : []
  if (entries.length === 0) return []

  const dead = firstInfo(entries, ['Dead Click Count', 'DeadClickCount'])
  const rage = firstInfo(entries, ['Rage Click Count', 'RageClickCount'])
  const scrollInfo = firstInfo(entries, ['Scroll Depth', 'ScrollDepth'])
  const trafficInfo = firstInfo(entries, ['Traffic'])
  const engInfo = firstInfo(entries, ['Engagement Time', 'EngagementTime'])
  const scriptErr = firstInfo(entries, ['Script Error Count', 'ScriptErrorCount'])
  const quickback = firstInfo(entries, ['Quickback Click', 'QuickbackClick', 'QuickbackCount'])
  const excessive = firstInfo(entries, ['Excessive Scroll', 'ExcessiveScroll', 'ExcessiveScrollCount'])

  const pages = allInfo(entries, ['Popular Pages', 'PopularPages'])

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
    sourceWindowDays: opts.numOfDays,
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

  for (const p of pages) {
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

  const referrerRows = allInfo(entries, ['Referrer URL', 'Referrers', 'Referrer'])
  for (const ref of referrerRows) {
    const label = String(ref.url ?? ref.URL ?? ref.ReferrerURL ?? ref.referrer ?? ref.Referrer ?? '(direct)')
    const visits = visitsFromRow(ref)
    if (!visits && visits !== 0) continue
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

  const browserRows = allInfo(entries, ['Browser'])
  const deviceFallback = browserRows.length > 0 ? [] : allInfo(entries, ['Device'])
  const breakdownRows = browserRows.length > 0 ? browserRows : deviceFallback
  for (const b of breakdownRows) {
    const browser = String(b.Browser ?? b.browser ?? (browserRows.length ? '(unknown)' : ''))
    const device = String(b.Device ?? b.device ?? (!browserRows.length ? '(unknown)' : ''))
    const os = String(b.OS ?? b.Os ?? b.os ?? '')
    const visits = visitsFromRow(b)
    if (visits <= 0) continue
    const label = browser || device
    rows.push({
      sk: `${today}#b#${label.replaceAll('#', '_').slice(0, 120)}`,
      date: today,
      rowKind: 'device',
      clarityBrowser: browser || device,
      clarityDevice: device || browser,
      clarityOs: os,
      traffic: visits,
      engagementTime: 0,
      scrollDepth: 0,
      deadClickCount: 0,
      rageClickCount: 0,
      scriptErrorCount: 0,
    })
  }

  const countryRows = allInfo(entries, ['Country/Region', 'Country', 'Countries'])
  for (const c of countryRows) {
    const country = String(c['Country/Region'] ?? c.country ?? c.Country ?? '(unknown)')
    const visits = visitsFromRow(c)
    if (visits <= 0) continue
    rows.push({
      sk: `${today}#ct#${country.replaceAll('#', '_').slice(0, 120)}`,
      date: today,
      rowKind: 'geo',
      clarityDevice: country,
      traffic: visits,
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
