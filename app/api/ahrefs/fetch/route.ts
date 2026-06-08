/**
 * POST /api/ahrefs/fetch
 *
 * Ahrefs API からオーガニックキーワードを取得して S3 に保存する。
 * 既存の CSV アップロードと同じ AhrefsDataset 形式で保存するため、
 * 分析画面はそのまま使える。
 *
 * body: {
 *   target?:  string  // 省略時は env.AHREFS_TARGET_DOMAIN
 *   country?: string  // 省略時は env.AHREFS_COUNTRY or "jp"
 *   limit?:   number  // 省略時 500
 *   date?:    string  // YYYY-MM-DD 省略時は昨日
 * }
 *
 * response: { id, fileName, rowCount, type }
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchOrganicKeywords, fetchApiUsage } from '@/lib/ahrefsApi'
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      target?: string
      country?: string
      limit?: number
      date?: string
    }

    const rows = await fetchOrganicKeywords({
      target:  body.target,
      country: body.country,
      limit:   body.limit,
      date:    body.date,
    })

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'キーワードデータが見つかりません。ドメインと対象国を確認してください。' },
        { status: 400 }
      )
    }

    const target  = body.target  ?? process.env.AHREFS_TARGET_DOMAIN ?? 'unknown'
    const country = body.country ?? process.env.AHREFS_COUNTRY ?? 'jp'
    const date    = body.date    ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10)

    const id        = `api_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const now       = new Date().toISOString()
    const fileName  = `Ahrefs API - ${target} (${country}) ${date}`

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
      return NextResponse.json({ error: 'S3への保存に失敗しました' }, { status: 500 })
    }

    const index = await loadIndex()
    index.push({ id, uploadedAt: now, fileName, rowCount: rows.length, type: 'organic' })
    await saveIndex(index)

    // API使用量を取得して返す（任意）
    const usage = await fetchApiUsage()

    return NextResponse.json({
      id,
      fileName,
      rowCount: rows.length,
      type:     'organic',
      usage,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ahrefs APIからのデータ取得に失敗しました'
    console.error('[Ahrefs Fetch] error:', e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** GET /api/ahrefs/fetch → API 設定状態を返す（環境変数チェック用） */
export async function GET() {
  const apiKey = process.env.AHREFS_API_KEY?.trim()
  const domain = process.env.AHREFS_TARGET_DOMAIN?.trim()
  const country = process.env.AHREFS_COUNTRY?.trim() ?? 'jp'

  return NextResponse.json({
    configured: !!apiKey && !!domain,
    domain:     domain ?? null,
    country,
    hasApiKey:  !!apiKey,
  })
}
