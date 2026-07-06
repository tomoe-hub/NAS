/**
 * 自動記事生成のON/OFF設定（S3: auto-articles/settings.json）。
 *
 * 注意書きページのボタンから切り替え、cron 実行時に参照する。
 * 環境変数 AUTO_ARTICLE_DISABLED=1 は緊急停止用として別途優先される。
 */

import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'

const SETTINGS_KEY = 'auto-articles/settings.json'

export interface AutoArticleSettings {
  enabled: boolean
  updatedAt: string
}

const DEFAULT_SETTINGS: AutoArticleSettings = {
  enabled: true,
  updatedAt: '',
}

export async function loadAutoArticleSettings(): Promise<AutoArticleSettings> {
  const obj = await getS3ObjectAsText(SETTINGS_KEY)
  if (!obj) return { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(obj.content) as Partial<AutoArticleSettings>
    return {
      enabled: parsed.enabled !== false,
      updatedAt: parsed.updatedAt ?? '',
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function saveAutoArticleSettings(enabled: boolean): Promise<AutoArticleSettings> {
  const settings: AutoArticleSettings = {
    enabled,
    updatedAt: new Date().toISOString(),
  }
  const ok = await putS3Object(SETTINGS_KEY, JSON.stringify(settings, null, 2))
  if (!ok) {
    throw new Error('設定のS3保存に失敗しました')
  }
  return settings
}
