/**
 * 自動記事生成のKW選定ロジック（サーバー専用）。
 *
 * 曜日ローテーション:
 * - 月曜: 狙い目KW（優先度スコア最上位の未投稿KW）
 * - 水曜: 手薄カテゴリー補強KW（WPタグの記事数下位 × Ahrefs関連KW）
 * - 金曜: トレンド上昇KW（SVトレンド up の上位）
 *
 * 共通ルール:
 * - 直近90日以内に同一KWで投稿（publish/future）済みのKWは除外
 * - 自動生成ログに残っているKWも除外（呼び出し側から excludeKeywords で渡す）
 */

import { listS3Objects, getS3ObjectAsText } from '@/lib/s3Reference'
import type { SavedArticle } from '@/lib/types'
import type { ScoredKeyword } from '@/lib/ahrefsAnalyzer'
import { mergeAndAnalyze, mergeAndAnalyzeOrganic } from '@/lib/ahrefsAnalyzer'
import { loadRecentDatasets, findRelatedKeywords } from '@/lib/ahrefsLoader'
import { normalizeKeywordForArticleMatch } from '@/lib/keywordPublishIndex'
import { getWordPressConfig } from '@/lib/wordpress'
import { decodeHtmlEntities, type WpTagListItem } from '@/lib/wpTagList'
import { buildKwPrompt } from '@/lib/kwPromptBuilder'

export type AutoSlot = 'opportunity' | 'coverage' | 'trend'

export const AUTO_SLOT_LABELS: Record<AutoSlot, string> = {
  opportunity: '狙い目KW（月曜枠）',
  coverage: '手薄カテゴリー補強（水曜枠）',
  trend: 'トレンド上昇KW（金曜枠）',
}

/** 同一KWの再投稿を避ける期間（日） */
const SAME_KW_COOLDOWN_DAYS = 90

/** 自社ブランド系KWは自動生成の対象外 */
const BRAND_PATTERNS = ['日本提携支援', '提携支援', 'nihon-teikei', 'nihon teikei']

export interface AutoKwSelection {
  slot: AutoSlot
  keyword: string
  prompt: string
  /** 選定理由（ログ・通知用） */
  reason: string
  /** Ahrefsデータ（あれば） */
  ahrefs?: {
    volume: number
    kd: number
    cpc: number
  }
  /** 手薄タグ起点の場合のタグ情報 */
  gapTag?: { tagName: string; articleCount: number }
}

/** JSTの曜日（0=日〜6=土）から自動生成スロットを返す。対象外の曜日は null */
export function slotForWeekday(dowJst: number): AutoSlot | null {
  switch (dowJst) {
    case 1: return 'opportunity' // 月
    case 3: return 'coverage'    // 水
    case 5: return 'trend'       // 金
    default: return null
  }
}

function isBrandKeyword(keyword: string): boolean {
  const lower = keyword.toLowerCase()
  return BRAND_PATTERNS.some(p => lower.includes(p.toLowerCase()))
}

/**
 * 直近90日以内にWordPressへ投稿（publish/future）した記事のKW集合を返す。
 * S3の articles/ 全件を読むが、記事JSONは小さいため許容範囲。
 */
export async function loadRecentlyPublishedKeywords(): Promise<Set<string>> {
  const excluded = new Set<string>()
  const cutoff = Date.now() - SAME_KW_COOLDOWN_DAYS * 86400000

  try {
    const objects = await listS3Objects('articles/')
    const jsonFiles = objects.filter(o => o.key.endsWith('.json') && o.key !== 'articles/summary-index.json')
    const results = await Promise.all(jsonFiles.map(o => getS3ObjectAsText(o.key)))

    for (const result of results) {
      if (!result) continue
      let article: SavedArticle
      try {
        article = JSON.parse(result.content) as SavedArticle
      } catch {
        continue
      }
      const kw = normalizeKeywordForArticleMatch(article.targetKeyword ?? '')
      if (!kw) continue
      const st = article.wordpressPostStatus
      if (st !== 'publish' && st !== 'future') continue

      const when = Date.parse(article.wordpressPublishedAt ?? article.createdAt)
      if (!Number.isNaN(when) && when >= cutoff) {
        excluded.add(kw)
      }
    }
  } catch (e) {
    console.warn('[AutoKW] 投稿済みKWの読み込みに失敗（除外なしで続行）:', e)
  }

  return excluded
}

/** 除外判定を1箇所に集約 */
function buildExclusionCheck(
  recentKws: Set<string>,
  extraExcludes: string[],
): (keyword: string) => boolean {
  const extra = new Set(extraExcludes.map(normalizeKeywordForArticleMatch))
  return (keyword: string) => {
    const norm = normalizeKeywordForArticleMatch(keyword)
    if (!norm) return true
    if (isBrandKeyword(keyword)) return true
    if (recentKws.has(norm)) return true
    if (extra.has(norm)) return true
    return false
  }
}

function priorityLabel(p: number): string {
  return p === 3 ? '★★★即攻め' : p === 2 ? '★★有望' : p === 1 ? '★余力' : '対象外'
}

function selectionFromScored(
  slot: AutoSlot,
  row: ScoredKeyword,
  reason: string,
): AutoKwSelection {
  const prompt = buildKwPrompt({
    keyword: row.keyword,
    volume: row.volume,
    kd: row.kd,
    cpc: row.cpc,
    trend: row.trend,
    trendPercent: row.trendPercent,
    detectedCategory: row.detectedCategory,
    priorityLabel: priorityLabel(row.priority),
    score: row.score,
  })
  return {
    slot,
    keyword: row.keyword,
    prompt,
    reason,
    ahrefs: { volume: row.volume, kd: row.kd, cpc: row.cpc },
  }
}

/** Ahrefsデータセットを分析してスコア済みKWリストを返す（keywords型優先） */
async function loadScoredKeywords(): Promise<ScoredKeyword[]> {
  const datasets = await loadRecentDatasets(6)
  const kwRows = datasets.filter(d => d.type === 'keywords').map(d => d.keywords)
  if (kwRows.length > 0) {
    return mergeAndAnalyze(kwRows)
  }
  const organicRows = datasets.filter(d => d.type === 'organic').map(d => d.keywords)
  if (organicRows.length > 0) {
    return mergeAndAnalyzeOrganic(organicRows)
  }
  return []
}

/** WordPressタグを記事数昇順で取得（手薄カテゴリー判定用） */
async function loadWeakWpTags(limit: number): Promise<{ name: string; count: number }[]> {
  const config = getWordPressConfig()
  if (!config) return []

  const url = `${config.wpUrl}/wp-json/wp/v2/tags?per_page=100&orderby=count&order=asc&_fields=id,name,slug,count&hide_empty=true`
  const res = await fetch(url, {
    headers: { Authorization: config.authorization, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) {
    console.warn(`[AutoKW] WPタグ取得失敗: ${res.status}`)
    return []
  }
  const rows = (await res.json()) as WpTagListItem[]
  return rows
    .filter(t => (t.count ?? 0) > 0)
    .map(t => ({ name: decodeHtmlEntities(String(t.name ?? '')), count: t.count ?? 0 }))
    .sort((a, b) => a.count - b.count)
    .slice(0, limit)
}

/**
 * スロットに応じたKWを1件選定する。候補が尽きた場合は null。
 */
export async function selectAutoKeyword(
  slot: AutoSlot,
  options?: { excludeKeywords?: string[] },
): Promise<AutoKwSelection | null> {
  const recentKws = await loadRecentlyPublishedKeywords()
  const isExcluded = buildExclusionCheck(recentKws, options?.excludeKeywords ?? [])

  // ── 水曜: 手薄カテゴリー補強 ──────────────────────────────
  if (slot === 'coverage') {
    const weakTags = await loadWeakWpTags(8)
    for (const tag of weakTags) {
      // Ahrefsからタグ関連KWを検索（ボリューム降順）
      let candidates: Awaited<ReturnType<typeof findRelatedKeywords>> = []
      try {
        candidates = await findRelatedKeywords(tag.name, 5)
      } catch (e) {
        console.warn(`[AutoKW] 関連KW検索失敗 (${tag.name}):`, e)
      }

      for (const c of candidates) {
        if (isExcluded(c.keyword)) continue
        const prompt = buildKwPrompt({
          keyword: c.keyword,
          volume: c.volume,
          kd: c.kd,
          cpc: c.cpc,
          gap: { tagName: tag.name, articleCount: tag.count },
        })
        return {
          slot,
          keyword: c.keyword,
          prompt,
          reason: `手薄タグ「${tag.name}」（${tag.count}件）の関連KW。vol=${c.volume} KD=${c.kd}`,
          ahrefs: { volume: c.volume, kd: c.kd, cpc: c.cpc },
          gapTag: { tagName: tag.name, articleCount: tag.count },
        }
      }

      // Ahrefsに候補がなければタグ名そのものをKWにする
      if (!isExcluded(tag.name)) {
        const prompt = buildKwPrompt({
          keyword: tag.name,
          gap: { tagName: tag.name, articleCount: tag.count },
        })
        return {
          slot,
          keyword: tag.name,
          prompt,
          reason: `手薄タグ「${tag.name}」（${tag.count}件）。Ahrefs候補なしのためタグ名をKWに採用`,
          gapTag: { tagName: tag.name, articleCount: tag.count },
        }
      }
    }
    // 手薄タグで候補が尽きた場合は狙い目KWにフォールバック
    console.warn('[AutoKW] 手薄カテゴリー候補が尽きたため狙い目KWにフォールバック')
  }

  // ── 月曜: 狙い目KW / 金曜: トレンド上昇KW ─────────────────
  const scored = await loadScoredKeywords()
  if (scored.length === 0) return null

  if (slot === 'trend') {
    const trending = scored
      .filter(k => k.trend === 'up' && k.volume >= 50)
      .sort((a, b) => b.priority - a.priority || b.trendPercent - a.trendPercent || b.score - a.score)
    for (const row of trending) {
      if (isExcluded(row.keyword)) continue
      return selectionFromScored(
        slot,
        row,
        `トレンド上昇KW（+${row.trendPercent}%）。優先度=${priorityLabel(row.priority)} score=${row.score}`,
      )
    }
    // 上昇KWが尽きた場合は狙い目にフォールバック
    console.warn('[AutoKW] トレンド上昇候補が尽きたため狙い目KWにフォールバック')
  }

  // 狙い目KW（scored は priority → score 降順ソート済み）
  for (const row of scored) {
    if (row.priority === 0) break
    if (row.volume < 30) continue
    if (isExcluded(row.keyword)) continue
    return selectionFromScored(
      slot,
      row,
      `狙い目KW。優先度=${priorityLabel(row.priority)} score=${row.score} vol=${row.volume} KD=${row.kd}`,
    )
  }

  return null
}
