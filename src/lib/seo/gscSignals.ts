/**
 * 自動記事生成のKW選定にGSC実測データ（seo-metrics/gsc-daily.json）を
 * 組み込むためのシグナル集計（サーバー専用）。
 *
 * 閾値ゲート:
 * 直近28日の検索クエリ合計表示回数が GSC_MIN_TOTAL_IMPRESSIONS 未満の間は
 * enabled=false を返し、呼び出し側は従来どおり Ahrefs のみで動作する。
 * （データが十分に蓄積されるまで実測シグナルは自動的に無効）
 *
 * シグナル:
 * - strikeZone: 平均掲載順位4〜20位＆一定表示回数のクエリ
 *   → 既に評価され始めているKWとして選定時に加点する
 * - topRanking: 平均掲載順位3位以内＆一定表示回数のクエリ
 *   → 既に上位表示済みのため新規記事の対象から除外する（共食い防止）
 */

import { loadGscRows } from './seoStore'
import { normalizeKeywordForArticleMatch } from '@/lib/keywordPublishIndex'

/** 集計対象のウィンドウ（日） */
const WINDOW_DAYS = 28
/** この合計表示回数に達するまでGSCシグナルは無効（Ahrefsのみで動作） */
export const GSC_MIN_TOTAL_IMPRESSIONS = 3000
/** クエリ単位でシグナル対象とする最低表示回数 */
const MIN_QUERY_IMPRESSIONS = 30
/** ストライクゾーン（この順位帯なら記事強化で上位を狙える） */
const STRIKE_MIN_POSITION = 4
const STRIKE_MAX_POSITION = 20
/** これ以下の平均順位は「既に上位表示済み」とみなして除外 */
const TOP_MAX_POSITION = 3.5

export interface GscQueryStat {
  query: string
  clicks: number
  impressions: number
  ctr: number
  /** 表示回数加重の平均掲載順位 */
  position: number
}

export interface GscKwSignals {
  /** 閾値を満たしシグナルとして有効か */
  enabled: boolean
  /** 直近ウィンドウの合計表示回数 */
  totalImpressions: number
  windowDays: number
  /** 正規化KW → 統計（順位4〜20位のストライクゾーン） */
  strikeZone: Map<string, GscQueryStat>
  /** 既に上位表示（3位以内）の正規化KW集合 */
  topRanking: Set<string>
}

function disabledSignals(totalImpressions = 0): GscKwSignals {
  return {
    enabled: false,
    totalImpressions,
    windowDays: WINDOW_DAYS,
    strikeZone: new Map(),
    topRanking: new Set(),
  }
}

/**
 * S3のGSC日次データからKW選定用シグナルを構築する。
 * データ不足・読み込み失敗時は enabled=false（Ahrefsのみで続行）。
 */
export async function loadGscKwSignals(): Promise<GscKwSignals> {
  try {
    const rows = await loadGscRows()
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)

    // query行のみ集計（query×page 行はクエリ単位に合算）
    const byQuery = new Map<string, { clicks: number; impressions: number; posWeighted: number }>()
    let totalImpressions = 0
    for (const r of rows) {
      if ((r.rowType ?? 'query') !== 'query') continue
      if (!r.query || r.date < cutoff) continue
      totalImpressions += r.impressions
      const cur = byQuery.get(r.query) ?? { clicks: 0, impressions: 0, posWeighted: 0 }
      cur.clicks += r.clicks
      cur.impressions += r.impressions
      cur.posWeighted += r.position * r.impressions
      byQuery.set(r.query, cur)
    }

    if (totalImpressions < GSC_MIN_TOTAL_IMPRESSIONS) {
      return disabledSignals(totalImpressions)
    }

    const strikeZone = new Map<string, GscQueryStat>()
    const topRanking = new Set<string>()

    for (const [query, agg] of byQuery) {
      if (agg.impressions < MIN_QUERY_IMPRESSIONS) continue
      const norm = normalizeKeywordForArticleMatch(query)
      if (!norm) continue

      const position = agg.impressions > 0 ? agg.posWeighted / agg.impressions : 0
      if (position <= 0) continue

      if (position <= TOP_MAX_POSITION) {
        topRanking.add(norm)
        continue
      }
      if (position >= STRIKE_MIN_POSITION && position <= STRIKE_MAX_POSITION) {
        const stat: GscQueryStat = {
          query,
          clicks: agg.clicks,
          impressions: agg.impressions,
          ctr: agg.impressions > 0 ? agg.clicks / agg.impressions : 0,
          position,
        }
        const prev = strikeZone.get(norm)
        if (!prev || stat.impressions > prev.impressions) {
          strikeZone.set(norm, stat)
        }
      }
    }

    return { enabled: true, totalImpressions, windowDays: WINDOW_DAYS, strikeZone, topRanking }
  } catch (e) {
    console.warn('[GSC Signals] 読み込み失敗（Ahrefsのみで続行）:', e)
    return disabledSignals()
  }
}
