/**
 * 自動記事生成用のアイキャッチ画像選定（サーバー専用）。
 *
 * 画像ページ（画像ライブラリ = S3 article-images/）にある画像から
 * ランダムに1枚選ぶ。ただし以下のルールで重複を避ける:
 * 1. 直前の自動投稿と同じ画像は使わない（連続禁止）
 * 2. 同一週（月〜日）内の自動投稿で使った画像は使わない（同週禁止）
 *
 * 候補が尽きた場合は段階的にルールを緩和する（同週禁止 → 連続禁止のみ → 全画像）。
 */

import { listImages, getImageFile } from '@/lib/imageLibrary'
import type { AutoArticleLogEntry } from '@/lib/autoArticleLog'

export interface PickedAutoImage {
  /** 画像ライブラリのID */
  id: string
  imageBase64: string
  mimeType: string
  /** SavedArticle.imageUrl 用（アプリ内配信URL） */
  appUrl: string
}

/** 指定日（YYYY-MM-DD）が属する週の月曜日を YYYY-MM-DD で返す */
function mondayOfWeek(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = d.getUTCDay() // 0=日
  const diff = (dow + 6) % 7 // 月曜からの経過日数
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

/** publishDate が同じ週（月〜日）かどうか */
function isSameWeek(a: string, b: string): boolean {
  return mondayOfWeek(a) === mondayOfWeek(b)
}

/**
 * ログから除外すべき画像IDを計算する。
 * - sameWeekIds: 対象の公開日と同じ週に使用済みの画像
 * - lastUsedId: 直近の自動投稿で使用した画像（連続禁止）
 */
export function computeExcludedImageIds(
  log: AutoArticleLogEntry[],
  publishDate: string,
): { sameWeekIds: Set<string>; lastUsedId: string | null } {
  const used = log
    .filter(e => e.status === 'scheduled' && e.imageId)
    .sort((a, b) => a.publishDate.localeCompare(b.publishDate))

  const sameWeekIds = new Set<string>()
  for (const e of used) {
    if (isSameWeek(e.publishDate, publishDate)) {
      sameWeekIds.add(e.imageId!)
    }
  }

  // 対象公開日より前で最も新しい投稿の画像（連続禁止）
  const before = used.filter(e => e.publishDate < publishDate)
  const lastUsedId = before.length > 0 ? before[before.length - 1]!.imageId! : null

  return { sameWeekIds, lastUsedId }
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

/**
 * 画像ライブラリからルールに従ってアイキャッチを1枚選ぶ。
 * ライブラリが空の場合は null（呼び出し側で生成にフォールバック）。
 */
export async function pickAutoArticleImage(
  publishDate: string,
  log: AutoArticleLogEntry[],
): Promise<PickedAutoImage | null> {
  const entries = await listImages()
  if (entries.length === 0) return null

  const { sameWeekIds, lastUsedId } = computeExcludedImageIds(log, publishDate)

  // 段階的にルールを緩和しながら候補を絞る
  let candidates = entries.filter(e => !sameWeekIds.has(e.id) && e.id !== lastUsedId)
  if (candidates.length === 0) {
    console.warn('[AutoImage] 同週禁止ルールで候補が尽きたため連続禁止のみで再選定')
    candidates = entries.filter(e => e.id !== lastUsedId)
  }
  if (candidates.length === 0) {
    console.warn('[AutoImage] 候補が尽きたため全画像から選定')
    candidates = entries
  }

  const chosen = pickRandom(candidates)
  const file = await getImageFile(chosen.id)
  if (!file) {
    console.warn(`[AutoImage] 画像バイナリの取得に失敗: ${chosen.id}`)
    return null
  }

  return {
    id: chosen.id,
    imageBase64: file.buffer.toString('base64'),
    mimeType: file.contentType,
    appUrl: `/api/image-library/file?id=${encodeURIComponent(chosen.id)}`,
  }
}
