/**
 * Ahrefs API v3 クライアント
 *
 * Site Explorer › organic-keywords を使い、対象ドメインのオーガニック
 * 検索キーワード・順位・流入データを取得して AhrefsKeywordRow 形式に変換する。
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
  best_position_diff: number | null
  best_position_url: string | null
  volume: number | null
  keyword_difficulty: number | null
  cpc: number | null             // USD cents
  sum_traffic: number | null
  serp_features: string[] | null
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

function mapOrganicRow(row: AhrefsOrganicRow): AhrefsKeywordRow {
  const serpStr = Array.isArray(row.serp_features) ? row.serp_features.join(',') : ''
  return {
    keyword:          row.keyword,
    volume:           row.volume ?? 0,
    kd:               row.keyword_difficulty ?? 0,
    cpc:              row.cpc != null ? Math.round(row.cpc) / 100 : 0, // cents → dollars
    cps:              0,
    parentTopic:      '',
    svTrend:          [],
    svForecast:       [],
    category:         '',
    trafficPotential: 0,
    globalVolume:     0,
    intents:          '',
    position:         row.best_position,
    positionChange:   row.best_position_diff,
    url:              row.best_position_url ?? '',
    currentTraffic:   row.sum_traffic,
    previousTraffic:  null,
    trafficChange:    null,
    branded:          false,
    serpFeatures:     serpStr,
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

  // select には response schema に存在する列のみ指定（where 専用の boolean 列は除外）
  const SELECT_COLS = [
    'keyword',
    'best_position',
    'best_position_diff',
    'best_position_url',
    'volume',
    'keyword_difficulty',
    'cpc',
    'sum_traffic',
    'serp_features',
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
