import Papa from 'papaparse'

export type AhrefsDatasetType = 'keywords' | 'organic'

export interface AhrefsKeywordRow {
  keyword: string
  volume: number
  kd: number
  cpc: number
  cps: number
  parentTopic: string
  svTrend: number[]
  svForecast: number[]
  category: string
  trafficPotential: number
  globalVolume: number
  intents: string
  position: number | null
  positionChange: number | null
  url: string
  currentTraffic: number | null
  previousTraffic: number | null
  trafficChange: number | null
  branded: boolean
  serpFeatures: string
  /** データセット取得日（M/D 表示用。マージ時に付与） */
  datasetDate?: string
}

export interface AhrefsDataset {
  id: string
  uploadedAt: string
  fileName: string
  rowCount: number
  type: AhrefsDatasetType
  keywords: AhrefsKeywordRow[]
}

export interface DatasetMeta {
  id: string
  uploadedAt: string
  fileName: string
  rowCount: number
  type: AhrefsDatasetType
}

const HEADER_ALIASES: Record<string, string[]> = {
  keyword:          ['keyword', 'keywords'],
  volume:           ['volume', 'search volume', 'sv'],
  kd:               ['kd', 'keyword difficulty', 'difficulty'],
  cpc:              ['cpc', 'cost per click'],
  cps:              ['cps', 'clicks per search'],
  parentTopic:      ['parent keyword', 'parent topic', 'parent_topic'],
  svTrend:          ['sv trend'],
  svForecast:       ['sv forecasting trend'],
  category:         ['category'],
  trafficPotential: ['traffic potential'],
  globalVolume:     ['global volume'],
  intents:          ['intents'],
  serpFeatures:     ['serp features'],
  position:         ['current position', 'position'],
  positionChange:   ['position change'],
  url:              ['current url', 'url'],
  currentTraffic:   ['current organic traffic'],
  previousTraffic:  ['previous organic traffic'],
  trafficChange:    ['organic traffic change', 'traffic change'],
  branded:          ['branded'],
}

function normalizeHeader(raw: string): string {
  return raw
    .replace(/[\uFEFF\uFFFE]/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
}

function buildHeaderMap(headers: string[]): Record<string, string> {
  const normalized = headers.map(normalizeHeader)
  const map: Record<string, string> = {}

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias)
      if (idx >= 0) {
        map[field] = headers[idx]
        break
      }
    }
  }
  return map
}

function detectType(headerMap: Record<string, string>): AhrefsDatasetType {
  if (headerMap.position || headerMap.url || headerMap.currentTraffic) return 'organic'
  return 'keywords'
}

function parseTrendString(val: unknown): number[] {
  if (!val || typeof val !== 'string') return []
  const cleaned = val.replace(/^["']+|["']+$/g, '').trim()
  if (!cleaned) return []
  return cleaned.split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0)
}

function safeNum(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function safeNullNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '' || val === 'N/A' || val === '-') return null
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function getField(row: Record<string, unknown>, headerMap: Record<string, string>, field: string): unknown {
  const col = headerMap[field]
  if (!col) return undefined
  return row[col]
}

export function parseAhrefsCsv(csvText: string): { rows: AhrefsKeywordRow[]; type: AhrefsDatasetType } {
  const result = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  if (!result.data.length || !result.meta.fields?.length) {
    throw new Error('CSVにデータがありません')
  }

  const headerMap = buildHeaderMap(result.meta.fields)
  if (!headerMap.keyword) {
    throw new Error(`キーワード列が見つかりません。検出されたヘッダー: ${result.meta.fields.join(', ')}`)
  }

  const type = detectType(headerMap)

  const rows: AhrefsKeywordRow[] = result.data
    .filter(row => {
      const kw = getField(row, headerMap, 'keyword')
      return kw && typeof kw === 'string' && kw.trim().length > 0
    })
    .map(row => ({
      keyword:          String(getField(row, headerMap, 'keyword') ?? '').trim(),
      volume:           safeNum(getField(row, headerMap, 'volume')),
      kd:               safeNum(getField(row, headerMap, 'kd')),
      cpc:              safeNum(getField(row, headerMap, 'cpc')),
      cps:              safeNum(getField(row, headerMap, 'cps')),
      parentTopic:      String(getField(row, headerMap, 'parentTopic') ?? '').trim(),
      svTrend:          parseTrendString(getField(row, headerMap, 'svTrend')),
      svForecast:       parseTrendString(getField(row, headerMap, 'svForecast')),
      category:         String(getField(row, headerMap, 'category') ?? '').trim(),
      trafficPotential: safeNum(getField(row, headerMap, 'trafficPotential')),
      globalVolume:     safeNum(getField(row, headerMap, 'globalVolume')),
      intents:          String(getField(row, headerMap, 'intents') ?? '').trim(),
      position:         safeNullNum(getField(row, headerMap, 'position')),
      positionChange:   safeNullNum(getField(row, headerMap, 'positionChange')),
      url:              String(getField(row, headerMap, 'url') ?? '').trim(),
      currentTraffic:   safeNullNum(getField(row, headerMap, 'currentTraffic')),
      previousTraffic:  safeNullNum(getField(row, headerMap, 'previousTraffic')),
      trafficChange:    safeNullNum(getField(row, headerMap, 'trafficChange')),
      branded:          String(getField(row, headerMap, 'branded') ?? '').toLowerCase() === 'true',
      serpFeatures:     String(getField(row, headerMap, 'serpFeatures') ?? '').trim(),
    }))

  return { rows, type }
}
