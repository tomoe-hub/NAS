import { google } from 'googleapis'
import type { GscDailyRow, GscRowType } from './types'
import { loadServiceAccountCredentials } from './googleCredentials'

const GSC_ROW_LIMIT = 25000

function sanitizePart(s: string): string {
  return s.replaceAll('#', '_').slice(0, 400)
}

async function fetchGscWithDimensions(opts: {
  siteUrl: string
  startDate: string
  endDate: string
  dimensions: string[]
  rowType: GscRowType
}): Promise<GscDailyRow[]> {
  const credResult = loadServiceAccountCredentials()
  if (!credResult.ok) {
    throw new Error(`GSC: ${credResult.message}`)
  }

  const auth = new google.auth.GoogleAuth({
    credentials: credResult.creds,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  })
  const webmasters = google.searchconsole({ version: 'v1', auth })

  const out: GscDailyRow[] = []
  let startRow = 0

  // GSC Search Analytics API は rowLimit 25000 上限。startRow でページング。
  while (true) {
    const res = await webmasters.searchanalytics.query({
      siteUrl: opts.siteUrl,
      requestBody: {
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: opts.dimensions,
        rowLimit: GSC_ROW_LIMIT,
        startRow,
        dataState: 'all',
      },
    })

    const rows = res.data.rows ?? []

    for (const r of rows) {
      const dims = r.keys ?? []
      let date = ''
      let sk = ''
      let query: string | undefined
      let page: string | undefined
      let device: string | undefined
      let country: string | undefined

      if (opts.rowType === 'query') {
        date = dims[0] ?? ''
        query = dims[1] ?? ''
        page = dims[2] ?? ''
        sk = `${date}#${sanitizePart(query)}#${sanitizePart(page)}`
      } else if (opts.rowType === 'device') {
        date = dims[0] ?? ''
        device = dims[1] ?? ''
        page = dims[2] ?? ''
        sk = `${date}#d#${sanitizePart(device)}#${sanitizePart(page)}`
      } else {
        date = dims[0] ?? ''
        country = dims[1] ?? ''
        sk = `${date}#c#${sanitizePart(country)}`
      }

      out.push({
        sk,
        date,
        rowType: opts.rowType,
        query,
        page,
        device,
        country,
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      })
    }

    startRow += rows.length
    // 取得件数が rowLimit 未満なら最終ページ
    if (rows.length < GSC_ROW_LIMIT) break
  }

  return out
}

export async function fetchGscDailyRows(opts: {
  siteUrl: string
  startDate: string
  endDate: string
}): Promise<GscDailyRow[]> {
  const common = {
    siteUrl: opts.siteUrl,
    startDate: opts.startDate,
    endDate: opts.endDate,
  }

  const [byQuery, byDevice, byCountry] = await Promise.all([
    fetchGscWithDimensions({ ...common, dimensions: ['date', 'query', 'page'], rowType: 'query' }),
    fetchGscWithDimensions({ ...common, dimensions: ['date', 'device', 'page'], rowType: 'device' }),
    fetchGscWithDimensions({ ...common, dimensions: ['date', 'country'], rowType: 'country' }),
  ])

  return [...byQuery, ...byDevice, ...byCountry]
}
