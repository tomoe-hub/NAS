/**
 * GET /api/ahrefs/cron
 *
 * Vercel Cron Jobs から呼ばれる月次自動更新エンドポイント。
 * vercel.json で schedule を設定すると毎月1日0時（UTC）に実行される。
 *
 * セキュリティ: Authorization: Bearer <CRON_SECRET> で保護。
 * Vercel は cron 実行時に自動的にこのヘッダーを付与する。
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchOrganicKeywords } from '@/lib/ahrefsApi'
import { putS3Object, getS3ObjectAsText } from '@/lib/s3Reference'
import type { AhrefsDataset, DatasetMeta } from '@/lib/ahrefsCsvParser'

export const maxDuration = 60

const PREFIX    = 'kw-analysis/'
const INDEX_KEY = `${PREFIX}index.json`

async function loadIndex(): Promise<DatasetMeta[]> {
  const obj = await getS3ObjectAsText(INDEX_KEY)
  if (!obj) return []
  try { return JSON.parse(obj.content) as DatasetMeta[] } catch { return [] }
}

async function saveIndex(index: DatasetMeta[]): Promise<void> {
  await putS3Object(INDEX_KEY, JSON.stringify(index, null, 2))
}

export async function GET(request: NextRequest) {
  // セキュリティチェック: CRON_SECRET が設定されている場合は検証
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: '認証エラー' }, { status: 401 })
    }
  }

  try {
    const rows = await fetchOrganicKeywords()

    if (rows.length === 0) {
      console.warn('[Ahrefs Cron] キーワードデータが見つかりませんでした')
      return NextResponse.json({ ok: false, reason: 'no data' })
    }

    const target  = process.env.AHREFS_TARGET_DOMAIN ?? 'unknown'
    const country = process.env.AHREFS_COUNTRY ?? 'jp'
    const date    = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

    const id       = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const now      = new Date().toISOString()
    const fileName = `Ahrefs API - ${target} (${country}) ${date} [自動]`

    const dataset: AhrefsDataset = {
      id,
      uploadedAt: now,
      fileName,
      rowCount:   rows.length,
      type:       'organic',
      keywords:   rows,
    }

    const key   = `${PREFIX}datasets/${id}.json`
    const saved = await putS3Object(key, JSON.stringify(dataset))
    if (!saved) {
      console.error('[Ahrefs Cron] S3保存失敗')
      return NextResponse.json({ ok: false, reason: 's3 save failed' }, { status: 500 })
    }

    const index = await loadIndex()
    index.push({ id, uploadedAt: now, fileName, rowCount: rows.length, type: 'organic' })
    await saveIndex(index)

    console.log(`[Ahrefs Cron] 完了: ${rows.length} 件 → ${key}`)
    return NextResponse.json({ ok: true, id, rowCount: rows.length, fileName })
  } catch (e) {
    const message = e instanceof Error ? e.message : '不明なエラー'
    console.error('[Ahrefs Cron] エラー:', e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
