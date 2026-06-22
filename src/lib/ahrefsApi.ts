/**
 * Ahrefs API v3 クライアント
 *
 * - Site Explorer › organic-keywords: 対象ドメインの順位KWを取得
 * - Keywords Explorer › overview:      既存KWリストのメトリクスを一括更新
 *
 * 必要な環境変数:
 *   AHREFS_API_KEY       … APIキー（Ahrefs Developer ページで発行）
 *   AHREFS_TARGET_DOMAIN … 対象ドメイン（例: nihon-teikei.co.jp）
 *   AHREFS_COUNTRY       … 2文字の国コード（省略時: jp）
 */

import type { AhrefsKeywordRow } from './ahrefsCsvParser'

const BASE_URL = 'https://api.ahrefs.com/v3'

// ── 型定義（API レスポンス） ────────────────────────────

interface AhrefsOrganicRow {
  keyword: string
  best_position: number | null
  best_position_url: string | null
  volume: number | null
  keyword_difficulty: number | null
  cpc: number | null             // USD cents
  sum_traffic: number | null
  is_informational: boolean | null
  is_commercial: boolean | null
  is_transactional: boolean | null
  is_navigational: boolean | null
}

interface AhrefsOrganicResponse {
  keywords: AhrefsOrganicRow[]
}

export interface AhrefsApiOptions {
  /** 対象ドメイン（省略時は env.AHREFS_TARGET_DOMAIN） */
  target?: string
  /** 国コード ISO 3166-1 alpha-2（省略時は env.AHREFS_COUNTRY または "jp"） */
  country?: string
  /** 取得する最大件数（省略時: 500） */
  limit?: number
  /** 取得基準日 YYYY-MM-DD（省略時: 昨日） */
  date?: string
}

// ── ユーティリティ ────────────────────────────────────

/** データ取得基準日（Ahrefs は数日のタイムラグがあるため 5日前を使用） */
function recentDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 5)
  return d.toISOString().slice(0, 10)
}

function buildIntents(row: AhrefsOrganicRow): string {
  const parts: string[] = []
  if (row.is_informational) parts.push('Informational')
  if (row.is_commercial)    parts.push('Commercial')
  if (row.is_transactional) parts.push('Transactional')
  if (row.is_navigational)  parts.push('Navigational')
  return parts.join(',')
}

function mapOrganicRow(row: AhrefsOrganicRow): AhrefsKeywordRow {
  return {
    keyword:          row.keyword,
    volume:           row.volume ?? 0,
    kd:               row.keyword_difficulty ?? 0,
    cpc:              row.cpc != null ? Math.round(row.cpc) / 100 : 0,
    cps:              0,
    parentTopic:      '',
    svTrend:          [],
    svForecast:       [],
    category:         '',
    trafficPotential: 0,
    globalVolume:     0,
    intents:          buildIntents(row),
    position:         row.best_position,
    positionChange:   null,
    url:              row.best_position_url ?? '',
    currentTraffic:   row.sum_traffic,
    previousTraffic:  null,
    trafficChange:    null,
    branded:          false,
    serpFeatures:     '',
  }
}

// ── 公開 API ────────────────────────────────────────────

/**
 * Site Explorer の organic-keywords エンドポイントから
 * 対象ドメインのオーガニックキーワードを取得する。
 *
 * @returns AhrefsKeywordRow[] の配列（既存 CSV パーサと同形式）
 * @throws API キーが未設定の場合、またはネットワークエラー時
 */
export async function fetchOrganicKeywords(options: AhrefsApiOptions = {}): Promise<AhrefsKeywordRow[]> {
  const apiKey = process.env.AHREFS_API_KEY?.trim()
  if (!apiKey) throw new Error('AHREFS_API_KEY が設定されていません')

  const target  = options.target  ?? process.env.AHREFS_TARGET_DOMAIN?.trim()
  const country = options.country ?? process.env.AHREFS_COUNTRY?.trim() ?? 'jp'
  const limit   = options.limit   ?? 500
  const date    = options.date    ?? recentDate()

  if (!target) throw new Error('対象ドメインが指定されていません（AHREFS_TARGET_DOMAIN を設定してください）')

  // エラーメッセージで確認済みの利用可能列のみ使用
  const SELECT_COLS = [
    'keyword',
    'best_position',
    'best_position_url',
    'volume',
    'keyword_difficulty',
    'cpc',
    'sum_traffic',
    'is_informational',
    'is_commercial',
    'is_transactional',
    'is_navigational',
  ].join(',')

  const params = new URLSearchParams({
    target,
    mode:    'domain',
    country,
    date,
    limit:   String(Math.min(limit, 1000)),
    select:  SELECT_COLS,
    order_by: 'sum_traffic:desc',
  })

  const url = `${BASE_URL}/site-explorer/organic-keywords?${params.toString()}`

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    // Vercel Edge / Node では next cache を使わずに毎回フェッチ
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ahrefs API エラー ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = (await res.json()) as AhrefsOrganicResponse
  const rows = data.keywords ?? []

  return rows.map(mapOrganicRow)
}

// ── Keywords Explorer ────────────────────────────────────

interface KwExplorerRow {
  keyword: string
  volume: number | null
  difficulty: number | null
  cpc: number | null
  cps: number | null
  parent_topic: string | null
  traffic_potential: number | null
  global_volume: number | null
  intents: {
    informational?: boolean
    navigational?: boolean
    commercial?: boolean
    transactional?: boolean
    branded?: boolean
    local?: boolean
  } | null
  serp_features?: string[] | null
}

interface KwExplorerResponse {
  keywords?: KwExplorerRow[]
}

function buildIntentsFromObject(
  intents: KwExplorerRow['intents']
): string {
  if (!intents) return ''
  const parts: string[] = []
  if (intents.informational)  parts.push('Informational')
  if (intents.commercial)     parts.push('Commercial')
  if (intents.transactional)  parts.push('Transactional')
  if (intents.navigational)   parts.push('Navigational')
  if (intents.branded)        parts.push('Branded')
  if (intents.local)          parts.push('Local')
  return parts.join(',')
}

function mapKwExplorerRow(row: KwExplorerRow): AhrefsKeywordRow {
  return {
    keyword:          row.keyword,
    volume:           row.volume ?? 0,
    kd:               row.difficulty ?? 0,
    cpc:              row.cpc != null ? Math.round(row.cpc) / 100 : 0,
    cps:              row.cps ?? 0,
    parentTopic:      row.parent_topic ?? '',
    svTrend:          [],   // KE overview では履歴は別エンドポイントのため省略
    svForecast:       [],
    category:         '',
    trafficPotential: row.traffic_potential ?? 0,
    globalVolume:     row.global_volume ?? 0,
    intents:          buildIntentsFromObject(row.intents),
    position:         null,
    positionChange:   null,
    url:              '',
    currentTraffic:   null,
    previousTraffic:  null,
    trafficChange:    null,
    branded:          false,
    serpFeatures:     (row.serp_features ?? []).join(','),
  }
}

/** バッチサイズ（KE API は 1 リクエストに含めるキーワード数の上限がプランで変わる） */
const KE_BATCH_SIZE = 100

/**
 * Keywords Explorer overview エンドポイントを使って
 * 任意のキーワードリストのメトリクスを取得する。
 *
 * @param keywords 更新したいキーワードの配列
 * @param options  country などオプション
 */
export async function fetchKeywordMetrics(
  keywords: string[],
  options: { country?: string } = {}
): Promise<AhrefsKeywordRow[]> {
  const apiKey = process.env.AHREFS_API_KEY?.trim()
  if (!apiKey) throw new Error('AHREFS_API_KEY が設定されていません')
  if (keywords.length === 0) return []

  const country = options.country ?? process.env.AHREFS_COUNTRY?.trim() ?? 'jp'

  // volume・difficulty など 10-unit フィールドは必要最小限に絞る
  const SELECT_COLS = [
    'keyword',
    'volume',
    'difficulty',
    'cpc',
    'cps',
    'parent_topic',
    'traffic_potential',
    'global_volume',
    'intents',
    'serp_features',
  ].join(',')

  const results: AhrefsKeywordRow[] = []

  // キーワードをバッチに分割してリクエスト
  for (let i = 0; i < keywords.length; i += KE_BATCH_SIZE) {
    const batch = keywords.slice(i, i + KE_BATCH_SIZE)
    const params = new URLSearchParams({
      keywords: batch.join(','),
      country,
      select:   SELECT_COLS,
      limit:    String(KE_BATCH_SIZE),
    })

    const url = `${BASE_URL}/keywords-explorer/overview?${params.toString()}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Ahrefs KE API エラー ${res.status}: ${body.slice(0, 300)}`)
    }

    const data = (await res.json()) as KwExplorerResponse
    const rows = data.keywords ?? []
    results.push(...rows.map(mapKwExplorerRow))
  }

  return results
}

/**
 * Ahrefs API の残りユニット数を返す（任意で使用）。
 * plan/subscription エンドポイントを呼ぶ。
 */
export async function fetchApiUsage(): Promise<{ units_used_this_month: number; units_limit_per_month: number } | null> {
  const apiKey = process.env.AHREFS_API_KEY?.trim()
  if (!apiKey) return null

  try {
    const res = await fetch(`${BASE_URL}/subscription-info/limits-and-usage`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as { units_used_this_month: number; units_limit_per_month: number }
  } catch {
    return null
  }
}
