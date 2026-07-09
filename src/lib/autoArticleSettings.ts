/**
 * 自動記事生成の設定（S3: auto-articles/settings.json）。
 *
 * 投稿スケジュールページ・注意書きページから変更し、cron 実行時に参照する。
 * 環境変数 AUTO_ARTICLE_DISABLED=1 は緊急停止用として別途優先される。
 */

import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'

const SETTINGS_KEY = 'auto-articles/settings.json'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export interface AutoArticleSettings {
  enabled: boolean
  /** 自動投稿の開始日（YYYY-MM-DD）。未設定はシステム既定の開始日 */
  startDate?: string
  /** 自動投稿の終了日（YYYY-MM-DD、この日の投稿まで実行）。未設定は無期限 */
  endDate?: string
  updatedAt: string
}

const DEFAULT_SETTINGS: AutoArticleSettings = {
  enabled: true,
  updatedAt: '',
}

function normalizeDate(v: unknown): string | undefined {
  return typeof v === 'string' && ISO_DATE.test(v) ? v : undefined
}

export async function loadAutoArticleSettings(): Promise<AutoArticleSettings> {
  const obj = await getS3ObjectAsText(SETTINGS_KEY)
  if (!obj) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(obj.content) as Partial<AutoArticleSettings>
    return {
      enabled: parsed.enabled !== false,
      startDate: normalizeDate(parsed.startDate),
      endDate: normalizeDate(parsed.endDate),
      updatedAt: parsed.updatedAt ?? '',
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * 設定を部分更新して保存する。
 * startDate / endDate は空文字を渡すとクリア（未設定に戻す）。
 */
export async function saveAutoArticleSettings(update: {
  enabled?: boolean
  startDate?: string
  endDate?: string
}): Promise<AutoArticleSettings> {
  const current = await loadAutoArticleSettings()

  const resolveDate = (next: string | undefined, cur: string | undefined): string | undefined => {
    if (next === undefined) return cur
    if (next === '') return undefined
    return normalizeDate(next) ?? cur
  }

  const settings: AutoArticleSettings = {
    enabled: update.enabled ?? current.enabled,
    startDate: resolveDate(update.startDate, current.startDate),
    endDate: resolveDate(update.endDate, current.endDate),
    updatedAt: new Date().toISOString(),
  }
  const ok = await putS3Object(SETTINGS_KEY, JSON.stringify(settings, null, 2))
  if (!ok) {
    throw new Error('設定のS3保存に失敗しました')
  }
  return settings
}
