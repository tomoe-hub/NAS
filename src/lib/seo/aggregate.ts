/**
 * S3に蓄積したSEOメトリクスの集計ロジック。
 * NIS の aggregate.ts（DynamoDB読込）を S3 一括読込に書き換えたもの。
 */
import { addDays, format, parseISO } from 'date-fns'
import { rangeKeyOrDefault, resolveWindow, type RangeKey, type ResolvedWindow } from './dateRange'
import { loadClarityRows, loadGa4Rows, loadGscRows, loadSyncMeta } from './seoStore'
import type { ClarityDailyRow, Ga4DailyRow, GscDailyRow, SeoSyncMeta } from './types'

function inRange(dateStr: string, start: string, end: string) {
  return dateStr >= start && dateStr <= end
}

function isGscQueryRow(r: GscDailyRow): boolean {
  return r.rowType === 'query' || r.rowType === undefined
}

function isGa4KpiRow(r: Ga4DailyRow): boolean {
  return r.rowType === 'kpi'
}

function isGa4MainRow(r: Ga4DailyRow): boolean {
  return r.rowType === 'main' || r.rowType === undefined
}

function isClaritySummary(r: ClarityDailyRow): boolean {
  return r.rowKind === 'summary' || r.url === '(project-summary)'
}

/* ── 基礎集計 ── */

function aggregateGsc(rows: GscDailyRow[]) {
  const q = rows.filter(isGscQueryRow)
  let clicks = 0
  let impressions = 0
  let weightedPos = 0
  for (const r of q) {
    clicks += r.clicks
    impressions += r.impressions
    weightedPos += r.position * (r.impressions || 0)
  }
  const ctr = impressions > 0 ? clicks / impressions : 0
  const avgPosition = impressions > 0 ? weightedPos / impressions : 0
  return { clicks, impressions, ctr, avgPosition }
}

function aggregateGa4(rows: Ga4DailyRow[]) {
  const kpiRows = rows.filter(isGa4KpiRow)
  // "kpi" 行（date軸のみ）を優先し、pagePath 合算による sessions 過大計上を防ぐ
  const m = kpiRows.length > 0 ? kpiRows : rows.filter(isGa4MainRow)
  let sessions = 0
  let users = 0
  let newUsers = 0
  let pageViews = 0
  let conversions = 0
  let engageWeighted = 0
  let engagedSessions = 0
  for (const r of m) {
    sessions += r.sessions
    users += r.activeUsers
    newUsers += r.newUsers
    pageViews += r.pageViews
    conversions += r.conversions
    engageWeighted += (r.engagementRate ?? 0) * r.sessions
    engagedSessions += r.engagedSessions ?? 0
  }
  const engagementRate = sessions > 0 ? engageWeighted / sessions : 0
  return { sessions, users, newUsers, pageViews, conversions, engagementRate, engagedSessions }
}

export interface ClarityUx {
  snapshotDate: string
  windowDays: number
  sessions: number
  distinctUsers: number
  totalPageviews: number
  pagesPerSession: number
  scrollDepth: number
  engagementTime: number
  deadClickCount: number
  rageClickCount: number
  scriptErrorCount: number
  quickbackCount: number
  excessiveScrollCount: number
  deadClickRate: number
  rageClickRate: number
  botTrafficRate: number
  /** 0-100 の簡易UXスコア */
  score: number
}

function aggregateClarityUx(rows: ClarityDailyRow[]): ClarityUx | null {
  // 最新スナップショット日の summary 行を使う
  const summaries = rows.filter(isClaritySummary).sort((a, b) => (a.date < b.date ? 1 : -1))
  const summary = summaries[0]
  if (!summary) return null
  const traffic = Math.max(1, summary.traffic || 1)
  const deadClickRate = summary.deadClickCount / traffic
  const rageClickRate = summary.rageClickCount / traffic
  const scrollDepth = summary.scrollDepth
  const score = Math.max(
    0,
    Math.min(100, Math.round(100 - deadClickRate * 200 - rageClickRate * 300 + scrollDepth * 0.2)),
  )
  const bots = summary.botSessionCount ?? 0
  const humanSessions = summary.traffic || 0
  const botTrafficRate = bots + humanSessions > 0 ? bots / (bots + humanSessions) : 0
  return {
    snapshotDate: summary.date,
    windowDays: summary.sourceWindowDays ?? 3,
    sessions: summary.traffic,
    distinctUsers: summary.distinctUsers ?? 0,
    totalPageviews: summary.totalPageviews ?? 0,
    pagesPerSession: summary.pagesPerSession ?? 0,
    scrollDepth,
    engagementTime: summary.engagementTime,
    deadClickCount: summary.deadClickCount,
    rageClickCount: summary.rageClickCount,
    scriptErrorCount: summary.scriptErrorCount,
    quickbackCount: summary.quickbackCount ?? 0,
    excessiveScrollCount: summary.excessiveScrollCount ?? 0,
    deadClickRate,
    rageClickRate,
    botTrafficRate,
    score,
  }
}

/* ── ダッシュボード用バンドル ── */

export interface SeoKpiSnapshot {
  sessions: number
  users: number
  newUsers: number
  pageViews: number
  conversions: number
  engagementRate: number
  impressions: number
  clicks: number
  ctr: number
  avgPosition: number
}

export interface SeoKpiChange {
  sessions: number
  users: number
  newUsers: number
  pageViews: number
  conversions: number
  /** pt 差 */
  engagementRate: number
  impressions: number
  clicks: number
  /** pt 差 */
  ctr: number
  /** 絶対差（マイナスが改善） */
  avgPosition: number
}

export interface SeoTimeseriesPoint {
  date: string
  sessions: number
  users: number
  clicks: number
  impressions: number
  avgPosition: number
}

export interface SeoDashboardData {
  window: ResolvedWindow
  hasData: boolean
  kpi: {
    current: SeoKpiSnapshot
    previous: SeoKpiSnapshot
    change: SeoKpiChange
  }
  timeseries: SeoTimeseriesPoint[]
  channelMix: Array<{ name: string; sessions: number; conversions: number; share: number }>
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>
  topPagesGsc: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>
  topPagesGa4: Array<{ pagePath: string; sessions: number; pageViews: number; engagementRate: number }>
  gscDevices: Array<{ device: string; clicks: number; impressions: number; ctr: number }>
  gscCountries: Array<{ country: string; clicks: number; impressions: number; ctr: number }>
  ga4Devices: Array<{ deviceCategory: string; sessions: number; users: number }>
  clarity: {
    ux: ClarityUx
    topPages: Array<{ url: string; traffic: number; scrollDepth: number; deadClickCount: number; rageClickCount: number }>
    referrers: Array<{ referrer: string; traffic: number }>
    browsers: Array<{ browser: string; traffic: number }>
  } | null
  meta: SeoSyncMeta
  freshnessNote: string
}

function snapshotOf(ga4: ReturnType<typeof aggregateGa4>, gsc: ReturnType<typeof aggregateGsc>): SeoKpiSnapshot {
  return {
    sessions: ga4.sessions,
    users: ga4.users,
    newUsers: ga4.newUsers,
    pageViews: ga4.pageViews,
    conversions: ga4.conversions,
    engagementRate: ga4.engagementRate,
    impressions: gsc.impressions,
    clicks: gsc.clicks,
    ctr: gsc.ctr,
    avgPosition: gsc.avgPosition,
  }
}

export async function buildSeoDashboardData(rangeRaw: string | null | undefined): Promise<SeoDashboardData> {
  const range: RangeKey = rangeKeyOrDefault(rangeRaw)
  const window = resolveWindow(range)

  const [allGa4, allGsc, allClarity, meta] = await Promise.all([
    loadGa4Rows(),
    loadGscRows(),
    loadClarityRows(),
    loadSyncMeta(),
  ])

  const ga4Cur = allGa4.filter(r => inRange(r.date, window.start, window.end))
  const ga4Prev = allGa4.filter(r => inRange(r.date, window.prevStart, window.prevEnd))
  const gscCur = allGsc.filter(r => inRange(r.date, window.start, window.end))
  const gscPrev = allGsc.filter(r => inRange(r.date, window.prevStart, window.prevEnd))

  const current = snapshotOf(aggregateGa4(ga4Cur), aggregateGsc(gscCur))
  const previous = snapshotOf(aggregateGa4(ga4Prev), aggregateGsc(gscPrev))

  const pct = (cur: number, prev: number) => {
    if (prev === 0) return cur === 0 ? 0 : 100
    return ((cur - prev) / prev) * 100
  }

  const change: SeoKpiChange = {
    sessions: pct(current.sessions, previous.sessions),
    users: pct(current.users, previous.users),
    newUsers: pct(current.newUsers, previous.newUsers),
    pageViews: pct(current.pageViews, previous.pageViews),
    conversions: pct(current.conversions, previous.conversions),
    engagementRate: (current.engagementRate - previous.engagementRate) * 100,
    impressions: pct(current.impressions, previous.impressions),
    clicks: pct(current.clicks, previous.clicks),
    ctr: (current.ctr - previous.ctr) * 100,
    avgPosition: current.avgPosition - previous.avgPosition,
  }

  /* 時系列（日別） */
  const gscByDate = new Map<string, GscDailyRow[]>()
  for (const r of gscCur) {
    if (!isGscQueryRow(r)) continue
    const arr = gscByDate.get(r.date) ?? []
    arr.push(r)
    gscByDate.set(r.date, arr)
  }
  const ga4ByDate = new Map<string, Ga4DailyRow[]>()
  for (const r of ga4Cur) {
    const arr = ga4ByDate.get(r.date) ?? []
    arr.push(r)
    ga4ByDate.set(r.date, arr)
  }

  const timeseries: SeoTimeseriesPoint[] = []
  let d = parseISO(window.start)
  const endDate = parseISO(window.end)
  while (d <= endDate) {
    const day = format(d, 'yyyy-MM-dd')
    const g = aggregateGsc(gscByDate.get(day) ?? [])
    const a = aggregateGa4(ga4ByDate.get(day) ?? [])
    timeseries.push({
      date: day,
      sessions: a.sessions,
      users: a.users,
      clicks: g.clicks,
      impressions: g.impressions,
      avgPosition: Math.round(g.avgPosition * 10) / 10,
    })
    d = addDays(d, 1)
  }

  /* チャネル構成（GA4 channel 行） */
  const channelBy = new Map<string, { sessions: number; conversions: number }>()
  for (const r of ga4Cur) {
    if (r.rowType !== 'channel') continue
    const k = r.channelGroup ?? '(not set)'
    const cur = channelBy.get(k) ?? { sessions: 0, conversions: 0 }
    cur.sessions += r.sessions
    cur.conversions += r.conversions
    channelBy.set(k, cur)
  }
  const channelTotal = [...channelBy.values()].reduce((s, v) => s + v.sessions, 0) || 1
  const channelMix = [...channelBy.entries()]
    .map(([name, v]) => ({
      name,
      sessions: v.sessions,
      conversions: v.conversions,
      share: Math.round((v.sessions / channelTotal) * 1000) / 10,
    }))
    .sort((a, b) => b.sessions - a.sessions)

  /* 上位クエリ（GSC query 行） */
  const queryBy = new Map<string, { clicks: number; impressions: number; weightedPos: number }>()
  for (const r of gscCur) {
    if (!isGscQueryRow(r)) continue
    const q = r.query ?? '(not set)'
    const cur = queryBy.get(q) ?? { clicks: 0, impressions: 0, weightedPos: 0 }
    cur.clicks += r.clicks
    cur.impressions += r.impressions
    cur.weightedPos += r.position * (r.impressions || 0)
    queryBy.set(q, cur)
  }
  const topQueries = [...queryBy.entries()]
    .map(([query, v]) => ({
      query,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      position: v.impressions > 0 ? v.weightedPos / v.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 20)

  /* 上位ページ（GSC query 行の page 集計） */
  const pageBy = new Map<string, { clicks: number; impressions: number; weightedPos: number }>()
  for (const r of gscCur) {
    if (!isGscQueryRow(r) || !r.page) continue
    const cur = pageBy.get(r.page) ?? { clicks: 0, impressions: 0, weightedPos: 0 }
    cur.clicks += r.clicks
    cur.impressions += r.impressions
    cur.weightedPos += r.position * (r.impressions || 0)
    pageBy.set(r.page, cur)
  }
  const topPagesGsc = [...pageBy.entries()]
    .map(([page, v]) => ({
      page,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      position: v.impressions > 0 ? v.weightedPos / v.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 20)

  /* 上位ページ（GA4 main 行の pagePath 集計） */
  const ga4PageBy = new Map<string, { sessions: number; pageViews: number; engWeighted: number }>()
  for (const r of ga4Cur) {
    if (r.rowType !== 'main' || !r.pagePath) continue
    const cur = ga4PageBy.get(r.pagePath) ?? { sessions: 0, pageViews: 0, engWeighted: 0 }
    cur.sessions += r.sessions
    cur.pageViews += r.pageViews
    cur.engWeighted += (r.engagementRate ?? 0) * r.sessions
    ga4PageBy.set(r.pagePath, cur)
  }
  const topPagesGa4 = [...ga4PageBy.entries()]
    .map(([pagePath, v]) => ({
      pagePath,
      sessions: v.sessions,
      pageViews: v.pageViews,
      engagementRate: v.sessions > 0 ? v.engWeighted / v.sessions : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 20)

  /* デバイス・国（GSC） */
  const devBy = new Map<string, { clicks: number; impressions: number }>()
  const ctryBy = new Map<string, { clicks: number; impressions: number }>()
  for (const r of gscCur) {
    if (r.rowType === 'device' && r.device) {
      const cur = devBy.get(r.device) ?? { clicks: 0, impressions: 0 }
      cur.clicks += r.clicks
      cur.impressions += r.impressions
      devBy.set(r.device, cur)
    } else if (r.rowType === 'country' && r.country) {
      const cur = ctryBy.get(r.country) ?? { clicks: 0, impressions: 0 }
      cur.clicks += r.clicks
      cur.impressions += r.impressions
      ctryBy.set(r.country, cur)
    }
  }
  const gscDevices = [...devBy.entries()]
    .map(([device, v]) => ({
      device,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks)
  const gscCountries = [...ctryBy.entries()]
    .map(([country, v]) => ({
      country,
      clicks: v.clicks,
      impressions: v.impressions,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10)

  /* デバイス（GA4 deviceGeo 行） */
  const ga4DevBy = new Map<string, { sessions: number; users: number }>()
  for (const r of ga4Cur) {
    if (r.rowType !== 'deviceGeo' || !r.deviceCategory) continue
    const cur = ga4DevBy.get(r.deviceCategory) ?? { sessions: 0, users: 0 }
    cur.sessions += r.sessions
    cur.users += r.activeUsers
    ga4DevBy.set(r.deviceCategory, cur)
  }
  const ga4Devices = [...ga4DevBy.entries()]
    .map(([deviceCategory, v]) => ({ deviceCategory, sessions: v.sessions, users: v.users }))
    .sort((a, b) => b.sessions - a.sessions)

  /* Clarity（最新スナップショット） */
  const ux = aggregateClarityUx(allClarity)
  let clarity: SeoDashboardData['clarity'] = null
  if (ux) {
    const snapRows = allClarity.filter(r => r.date === ux.snapshotDate)
    const topPages = snapRows
      .filter(r => r.rowKind === 'page' && r.url)
      .map(r => ({
        url: r.url!,
        traffic: r.traffic,
        scrollDepth: r.scrollDepth,
        deadClickCount: r.deadClickCount,
        rageClickCount: r.rageClickCount,
      }))
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 10)
    const referrers = snapRows
      .filter(r => r.rowKind === 'referrer' && r.referrer)
      .map(r => ({ referrer: r.referrer!, traffic: r.traffic }))
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 10)
    const browsers = snapRows
      .filter(r => r.rowKind === 'device' && r.clarityBrowser)
      .map(r => ({ browser: r.clarityBrowser!, traffic: r.traffic }))
      .sort((a, b) => b.traffic - a.traffic)
      .slice(0, 8)
    clarity = { ux, topPages, referrers, browsers }
  }

  const hasData = allGa4.length > 0 || allGsc.length > 0 || allClarity.length > 0

  return {
    window,
    hasData,
    kpi: { current, previous, change },
    timeseries,
    channelMix,
    topQueries,
    topPagesGsc,
    topPagesGa4,
    gscDevices,
    gscCountries,
    ga4Devices,
    clarity,
    meta,
    freshnessNote:
      'Search Console のデータは通常2〜3日遅れて確定します。Clarity は直近数日間のライブ集計スナップショットです。',
  }
}
