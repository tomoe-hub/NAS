/**
 * 自動記事生成の実行ログ（S3: auto-articles/log.json）。
 *
 * 用途:
 * - 同一投稿日の二重生成防止（cron のリトライ・重複実行対策）
 * - 自動生成で使ったKWのクールダウン管理（90日）
 * - 実行履歴の確認
 */

import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import type { AutoSlot } from '@/lib/autoKwSelector'

const LOG_KEY = 'auto-articles/log.json'
/** ログの最大保持件数（古いものから削除） */
const MAX_ENTRIES = 500

export interface AutoArticleLogEntry {
  /** 公開予定日（YYYY-MM-DD, JST） */
  publishDate: string
  slot: AutoSlot
  keyword: string
  /** KW選定理由 */
  reason: string
  articleId?: string
  wpPostId?: number
  wpUrl?: string
  status: 'scheduled' | 'failed'
  error?: string
  createdAt: string
}

export async function loadAutoArticleLog(): Promise<AutoArticleLogEntry[]> {
  const obj = await getS3ObjectAsText(LOG_KEY)
  if (!obj) return []
  try {
    const parsed = JSON.parse(obj.content)
    return Array.isArray(parsed) ? (parsed as AutoArticleLogEntry[]) : []
  } catch {
    return []
  }
}

export async function appendAutoArticleLog(
  currentLog: AutoArticleLogEntry[],
  entry: AutoArticleLogEntry,
): Promise<void> {
  const next = [...currentLog, entry].slice(-MAX_ENTRIES)
  await putS3Object(LOG_KEY, JSON.stringify(next, null, 2))
}

/** 指定の投稿日に予約成功済みのエントリがあるか（二重生成防止） */
export function hasScheduledEntryForDate(
  log: AutoArticleLogEntry[],
  publishDate: string,
): boolean {
  return log.some(e => e.publishDate === publishDate && e.status === 'scheduled')
}

/** 直近N日以内に自動生成で使用したKW一覧（クールダウン用） */
export function recentKeywordsFromLog(
  log: AutoArticleLogEntry[],
  days: number,
): string[] {
  const cutoff = Date.now() - days * 86400000
  return log
    .filter(e => e.status === 'scheduled' && e.keyword && Date.parse(e.createdAt) >= cutoff)
    .map(e => e.keyword)
}
