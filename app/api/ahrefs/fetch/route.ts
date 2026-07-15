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
import { fetchOrganicKeywords, fetchKeywordMetrics, fetchApiUsage } from '@/lib/ahrefsApi'
import { putS3Object, getS3ObjectAsText } from '@/lib/s3Reference'
import type { AhrefsDataset, DatasetMeta } from '@/lib/ahrefsCsvParser'

export const maxDuration = 120

const PREFIX    = 'kw-analysis/'
const INDEX_KEY = `${PREFIX}index.json`
/** 成果測定用: 自社流入KWの日次順位スナップショット保存先 */
const HISTORY_PREFIX = `${PREFIX}history/`

async function loadIndex(): Promise<DatasetMeta[]> {
  const obj = await getS3ObjectAsText(INDEX_KEY)
  if (!obj) return []
  try { return JSON.parse(obj.content) as DatasetMeta[] } catch { return [] }
}

async function saveIndex(index: DatasetMeta[]): Promise<void> {
  await putS3Object(INDEX_KEY, JSON.stringify(index, null, 2))
}

/** 既存の type:'keywords' データセットからユニークKWリストを収集する */
async function collectExistingKeywords(index: DatasetMeta[]): Promise<string[]> {
  const kwMetas = index.filter(m => m.type === 'keywords')
  if (kwMetas.length === 0) return []

  const kwSet = new Set<string>()
  await Promise.all(
    kwMetas.map(async meta => {
      try {
        const key = `${PREFIX}datasets/${meta.id}.json`
        const obj = await getS3ObjectAsText(key)
        if (!obj) return
        const dataset = JSON.parse(obj.content) as AhrefsDataset
        for (const row of dataset.keywords) {
          if (row.keyword?.trim()) kwSet.add(row.keyword.trim())
        }
      } catch {
        // 個別データセット読み込み失敗は無視
      }
    })
  )
  return Array.from(kwSet)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      target?: string
      country?: string
      limit?: number
      date?: string
    }

    const target  = body.target  ?? process.env.AHREFS_TARGET_DOMAIN ?? 'unknown'
    const country = body.country ?? process.env.AHREFS_COUNTRY ?? 'jp'
    const date    = body.date    ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const now     = new Date().toISOString()

    // ── 1. 競合KW（Site Explorer organic-keywords）取得 ────────────────
    const organicRows = await fetchOrganicKeywords({
      target:  body.target,
      country: body.country,
      limit:   body.limit,
      date:    body.date,
    })

    if (organicRows.length === 0) {
      return NextResponse.json(
        { error: 'キーワードデータが見つかりません。ドメインと対象国を確認してください。' },
        { status: 400 }
      )
    }

    const organicId       = `api_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const organicFileName = `Ahrefs API (競合KW) - ${target} (${country}) ${date}`

    const organicDataset: AhrefsDataset = {
      id:         organicId,
      uploadedAt: now,
      fileName:   organicFileName,
      rowCount:   organicRows.length,
      type:       'organic',
      keywords:   organicRows,
    }

    const organicKey   = `${PREFIX}datasets/${organicId}.json`
    const organicSaved = await putS3Object(organicKey, JSON.stringify(organicDataset))
    if (!organicSaved) {
      return NextResponse.json({ error: 'S3への保存に失敗しました（競合KW）' }, { status: 500 })
    }

    const index = await loadIndex()
    index.push({
      id:         organicId,
      uploadedAt: now,
      fileName:   organicFileName,
      rowCount:   organicRows.length,
      type:       'organic',
    })

    // ── 成果測定用: 自社流入KWの順位スナップショットを日付キーで蓄積 ──
    // datasets/ は最新で置換されるが、history/ は日付ごとに残し続ける（時系列の源泉）。
    // 同日に複数回更新した場合は最新で上書き（1日1スナップショット）。
    const snapshotDate = now.slice(0, 10)
    const snapshot = {
      date:      snapshotDate,
      fetchedAt: now,
      domain:    target,
      country,
      keywords: organicRows.map(row => ({
        keyword:  row.keyword,
        position: row.position,
        volume:   row.volume,
        traffic:  row.currentTraffic,
        url:      row.url,
      })),
    }
    await putS3Object(`${HISTORY_PREFIX}${snapshotDate}.json`, JSON.stringify(snapshot))

    // ── 2. 狙い目KW（Keywords Explorer overview）取得 ──────────────────
    let keResult: { id: string; fileName: string; rowCount: number } | null = null
    let keError: string | null = null

    const existingKeywords = await collectExistingKeywords(index)
    if (existingKeywords.length > 0) {
      try {
        const keRows = await fetchKeywordMetrics(existingKeywords, { country })

        if (keRows.length > 0) {
          const keId       = `api_ke_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
          const keFileName = `Ahrefs API (狙い目KW) - ${country} ${date}`

          const keDataset: AhrefsDataset = {
            id:         keId,
            uploadedAt: now,
            fileName:   keFileName,
            rowCount:   keRows.length,
            type:       'keywords',
            keywords:   keRows,
          }

          const keKey = `${PREFIX}datasets/${keId}.json`
          await putS3Object(keKey, JSON.stringify(keDataset))

          index.push({
            id:         keId,
            uploadedAt: now,
            fileName:   keFileName,
            rowCount:   keRows.length,
            type:       'keywords',
          })

          keResult = { id: keId, fileName: keFileName, rowCount: keRows.length }
        }
      } catch (e) {
        keError = e instanceof Error ? e.message : 'Keywords Explorer取得エラー'
        console.error('[Ahrefs Fetch] KE error:', keError)
      }
    } else {
      keError = '狙い目KWのデータが見つかりません（先にCSVをインポートしてください）'
    }

    await saveIndex(index)

    // API使用量を取得して返す（任意）
    const usage = await fetchApiUsage()

    return NextResponse.json({
      organic: {
        id:       organicId,
        fileName: organicFileName,
        rowCount: organicRows.length,
        type:     'organic',
      },
      keywords: keResult ?? undefined,
      keError:  keError  ?? undefined,
      usage,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Ahrefs APIからのデータ取得に失敗しました'
    console.error('[Ahrefs Fetch] error:', message)
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
