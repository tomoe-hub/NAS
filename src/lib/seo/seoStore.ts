/**
 * SEOメトリクスのS3ストア。
 * NIS の DynamoDB テーブル（nis-gsc-daily 等）を S3 JSON に置き換えたもの。
 * 各ファイルは { updatedAt, rows: [...] } 形式で、sk をキーに upsert マージする。
 */
import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import type { Ga4DailyRow, GscDailyRow, ClarityDailyRow, SeoSyncMeta } from './types'

const GA4_KEY = 'seo-metrics/ga4-daily.json'
const GSC_KEY = 'seo-metrics/gsc-daily.json'
const CLARITY_KEY = 'seo-metrics/clarity-snapshots.json'
const META_KEY = 'seo-metrics/sync-meta.json'

/** これより古い日付の行はマージ時に破棄する（JSONの肥大化防止） */
const RETENTION_DAYS = 400

interface StoreFile<T> {
  updatedAt: string
  rows: T[]
}

function retentionCutoff(): string {
  const d = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
  return d.toISOString().slice(0, 10)
}

async function loadRows<T>(key: string): Promise<T[]> {
  const obj = await getS3ObjectAsText(key)
  if (!obj) return []
  try {
    const parsed = JSON.parse(obj.content) as StoreFile<T>
    return Array.isArray(parsed.rows) ? parsed.rows : []
  } catch {
    return []
  }
}

async function saveRows<T>(key: string, rows: T[]): Promise<boolean> {
  const file: StoreFile<T> = { updatedAt: new Date().toISOString(), rows }
  return putS3Object(key, JSON.stringify(file))
}

/** sk で upsert マージし、保持期間より古い行を破棄して保存する */
async function mergeRows<T extends { sk: string; date: string }>(
  key: string,
  newRows: T[],
): Promise<number> {
  const existing = await loadRows<T>(key)
  const bySk = new Map<string, T>()
  for (const r of existing) bySk.set(r.sk, r)
  for (const r of newRows) bySk.set(r.sk, r)

  const cutoff = retentionCutoff()
  const merged = [...bySk.values()].filter(r => r.date >= cutoff)
  merged.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0))

  const ok = await saveRows(key, merged)
  if (!ok) throw new Error(`S3への保存に失敗しました: ${key}`)
  return merged.length
}

export async function loadGa4Rows(): Promise<Ga4DailyRow[]> {
  return loadRows<Ga4DailyRow>(GA4_KEY)
}

export async function loadGscRows(): Promise<GscDailyRow[]> {
  return loadRows<GscDailyRow>(GSC_KEY)
}

export async function loadClarityRows(): Promise<ClarityDailyRow[]> {
  return loadRows<ClarityDailyRow>(CLARITY_KEY)
}

export async function mergeGa4Rows(rows: Ga4DailyRow[]): Promise<number> {
  return mergeRows(GA4_KEY, rows)
}

export async function mergeGscRows(rows: GscDailyRow[]): Promise<number> {
  return mergeRows(GSC_KEY, rows)
}

export async function mergeClarityRows(rows: ClarityDailyRow[]): Promise<number> {
  return mergeRows(CLARITY_KEY, rows)
}

export async function loadSyncMeta(): Promise<SeoSyncMeta> {
  const obj = await getS3ObjectAsText(META_KEY)
  if (!obj) return {}
  try {
    return JSON.parse(obj.content) as SeoSyncMeta
  } catch {
    return {}
  }
}

export async function saveSyncMeta(meta: SeoSyncMeta): Promise<void> {
  await putS3Object(META_KEY, JSON.stringify(meta))
}
