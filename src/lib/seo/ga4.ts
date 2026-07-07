import { BetaAnalyticsDataClient } from '@google-analytics/data'
import type { Ga4DailyRow } from './types'
import { loadServiceAccountCredentials } from './googleCredentials'

function smKey(source: string, medium: string) {
  const s = source || '(not set)'
  const m = medium || '(not set)'
  return `${s} / ${m}`.replaceAll('#', '_').slice(0, 200)
}

function sanitizePath(p: string) {
  return p.replaceAll('#', '_').slice(0, 400)
}

function sanitizeSeg(s: string) {
  return s.replaceAll('#', '_').slice(0, 200)
}

async function runGa4Report(
  client: BetaAnalyticsDataClient,
  propertyId: string,
  body: {
    dimensions: { name: string }[]
    metrics: { name: string }[]
    startDate: string
    endDate: string
    limit?: number
    offset?: number
  },
) {
  const { startDate, endDate, limit, offset, ...rest } = body
  const [resp] = await client.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate }],
    ...rest,
    limit: limit ?? 100000,
    offset: offset ?? 0,
  })
  return resp
}

function toIsoDate(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

/**
 * KPI サマリ行（date 軸のみ）。
 * sessions 等をページパス粒度の合算で過大計上しないための専用クエリ。rowType: "kpi"
 */
async function fetchGa4KpiRows(
  client: BetaAnalyticsDataClient,
  opts: { propertyId: string; startDate: string; endDate: string },
): Promise<Ga4DailyRow[]> {
  let offset = 0
  const out: Ga4DailyRow[] = []

  while (true) {
    const resp = await runGa4Report(client, opts.propertyId, {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'conversions' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'bounceRate' },
        { name: 'userEngagementDuration' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
      ],
      limit: 10000,
      offset,
    })

    for (const row of resp.rows ?? []) {
      const dim = row.dimensionValues ?? []
      const date = toIsoDate(dim[0]?.value ?? '')
      const met = row.metricValues ?? []
      out.push({
        sk: `${date}#kpi`,
        date,
        rowType: 'kpi',
        sessions: Number(met[0]?.value ?? 0),
        activeUsers: Number(met[1]?.value ?? 0),
        newUsers: Number(met[2]?.value ?? 0),
        conversions: Number(met[3]?.value ?? 0),
        engagedSessions: Number(met[4]?.value ?? 0),
        engagementRate: Number(met[5]?.value ?? 0),
        bounceRate: Number(met[6]?.value ?? 0),
        userEngagementDuration: Number(met[7]?.value ?? 0),
        pageViews: Number(met[8]?.value ?? 0),
        avgSessionDuration: Number(met[9]?.value ?? 0),
      })
    }

    const rowCount = resp.rows?.length ?? 0
    const rowCountInt = resp.rowCount ?? 0
    offset += rowCount
    if (rowCount < 10000 || offset >= rowCountInt) break
  }

  return out
}

/**
 * ページ×流入元 breakdown 行（pagePath × sessionSource × sessionMedium）。
 * 総KPI集計には使わず、ページ別レポートにのみ使用する。rowType: "main"
 */
async function fetchGa4MainRows(
  client: BetaAnalyticsDataClient,
  opts: { propertyId: string; startDate: string; endDate: string },
): Promise<Ga4DailyRow[]> {
  let offset = 0
  const out: Ga4DailyRow[] = []

  while (true) {
    const resp = await runGa4Report(client, opts.propertyId, {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: [
        { name: 'date' },
        { name: 'pagePath' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'conversions' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'userEngagementDuration' },
      ],
      limit: 100000,
      offset,
    })

    for (const row of resp.rows ?? []) {
      const dim = row.dimensionValues ?? []
      const date = toIsoDate(dim[0]?.value ?? '')
      const pagePath = dim[1]?.value ?? ''
      const source = dim[2]?.value ?? ''
      const medium = dim[3]?.value ?? ''
      const met = row.metricValues ?? []
      out.push({
        sk: `${date}#${sanitizePath(pagePath)}#${smKey(source, medium)}`,
        date,
        rowType: 'main',
        pagePath,
        sourceMedium: smKey(source, medium),
        sessions: Number(met[0]?.value ?? 0),
        activeUsers: Number(met[1]?.value ?? 0),
        newUsers: Number(met[2]?.value ?? 0),
        pageViews: Number(met[3]?.value ?? 0),
        avgSessionDuration: Number(met[4]?.value ?? 0),
        bounceRate: Number(met[5]?.value ?? 0),
        conversions: Number(met[6]?.value ?? 0),
        engagedSessions: Number(met[7]?.value ?? 0),
        engagementRate: Number(met[8]?.value ?? 0),
        userEngagementDuration: Number(met[9]?.value ?? 0),
      })
    }

    const rowCount = resp.rows?.length ?? 0
    const rowCountInt = resp.rowCount ?? 0
    offset += rowCount
    if (rowCount < 100000 || offset >= rowCountInt) break
  }

  return out
}

async function fetchGa4ChannelRows(
  client: BetaAnalyticsDataClient,
  opts: { propertyId: string; startDate: string; endDate: string },
): Promise<Ga4DailyRow[]> {
  let offset = 0
  const out: Ga4DailyRow[] = []

  while (true) {
    const resp = await runGa4Report(client, opts.propertyId, {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: [
        { name: 'date' },
        { name: 'sessionDefaultChannelGroup' },
        { name: 'landingPage' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'engagedSessions' },
        { name: 'engagementRate' },
        { name: 'conversions' },
      ],
      limit: 100000,
      offset,
    })

    for (const row of resp.rows ?? []) {
      const dim = row.dimensionValues ?? []
      const date = toIsoDate(dim[0]?.value ?? '')
      const channelGroup = dim[1]?.value ?? '(not set)'
      const landingPage = dim[2]?.value ?? '(not set)'
      const met = row.metricValues ?? []
      out.push({
        sk: `${date}#ch#${sanitizeSeg(channelGroup)}#${sanitizePath(landingPage)}`,
        date,
        rowType: 'channel',
        channelGroup,
        landingPage,
        sessions: Number(met[0]?.value ?? 0),
        activeUsers: Number(met[1]?.value ?? 0),
        newUsers: 0,
        pageViews: 0,
        avgSessionDuration: 0,
        bounceRate: 0,
        conversions: Number(met[4]?.value ?? 0),
        engagedSessions: Number(met[2]?.value ?? 0),
        engagementRate: Number(met[3]?.value ?? 0),
        userEngagementDuration: 0,
      })
    }

    const rowCount = resp.rows?.length ?? 0
    const rowCountInt = resp.rowCount ?? 0
    offset += rowCount
    if (rowCount < 100000 || offset >= rowCountInt) break
  }

  return out
}

async function fetchGa4DeviceGeoRows(
  client: BetaAnalyticsDataClient,
  opts: { propertyId: string; startDate: string; endDate: string },
): Promise<Ga4DailyRow[]> {
  let offset = 0
  const out: Ga4DailyRow[] = []

  while (true) {
    const resp = await runGa4Report(client, opts.propertyId, {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: [{ name: 'date' }, { name: 'deviceCategory' }, { name: 'country' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'bounceRate' },
        { name: 'userEngagementDuration' },
      ],
      limit: 100000,
      offset,
    })

    for (const row of resp.rows ?? []) {
      const dim = row.dimensionValues ?? []
      const date = toIsoDate(dim[0]?.value ?? '')
      const deviceCategory = dim[1]?.value ?? '(not set)'
      const country = dim[2]?.value ?? '(not set)'
      const met = row.metricValues ?? []
      out.push({
        sk: `${date}#dg#${sanitizeSeg(deviceCategory)}#${sanitizeSeg(country)}`,
        date,
        rowType: 'deviceGeo',
        deviceCategory,
        country,
        sessions: Number(met[0]?.value ?? 0),
        activeUsers: Number(met[1]?.value ?? 0),
        newUsers: 0,
        pageViews: 0,
        avgSessionDuration: 0,
        bounceRate: Number(met[2]?.value ?? 0),
        conversions: 0,
        userEngagementDuration: Number(met[3]?.value ?? 0),
      })
    }

    const rowCount = resp.rows?.length ?? 0
    const rowCountInt = resp.rowCount ?? 0
    offset += rowCount
    if (rowCount < 100000 || offset >= rowCountInt) break
  }

  return out
}

export async function fetchGa4DailyRows(opts: {
  propertyId: string
  startDate: string
  endDate: string
}): Promise<Ga4DailyRow[]> {
  const credResult = loadServiceAccountCredentials()
  if (!credResult.ok) {
    throw new Error(`GA4: ${credResult.message}`)
  }

  const client = new BetaAnalyticsDataClient({ credentials: credResult.creds })

  const base = {
    propertyId: opts.propertyId,
    startDate: opts.startDate,
    endDate: opts.endDate,
  }

  const [kpi, main, channel, deviceGeo] = await Promise.all([
    fetchGa4KpiRows(client, base),
    fetchGa4MainRows(client, base),
    fetchGa4ChannelRows(client, base),
    fetchGa4DeviceGeoRows(client, base),
  ])

  return [...kpi, ...main, ...channel, ...deviceGeo]
}
