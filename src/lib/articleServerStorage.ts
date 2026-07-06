/**
 * 記事のサーバー側ストレージ（S3）＋軽量サマリーインデックス。
 *
 * 一覧ページの高速化のため、本文・Base64画像を含まないサマリーを
 * articles/summary-index.json に集約して1回のS3取得で返せるようにする。
 * 記事の保存・削除は必ずこのモジュール経由で行い、インデックスを同期する。
 */

import { listS3Objects, getS3ObjectAsText, putS3Object, deleteS3Object } from '@/lib/s3Reference'
import type { SavedArticle } from '@/lib/types'

const PREFIX = 'articles/'
const SUMMARY_INDEX_KEY = 'articles/summary-index.json'
const EXCERPT_MAX = 160

function articleKey(id: string): string {
  return `${PREFIX}${id}.json`
}

/** 一覧表示用の軽量エントリ（本文・Base64画像を含まない） */
export type ArticleSummary = Omit<SavedArticle, 'originalContent' | 'refinedContent'> & {
  originalContent: ''
  refinedContent: ''
  excerpt: string
}

function buildExcerpt(article: SavedArticle): string {
  const raw = (article.refinedContent || article.originalContent || '').replace(/\s+/g, ' ').trim()
  if (raw.length <= EXCERPT_MAX) return raw
  return raw.slice(0, EXCERPT_MAX).trim() + '…'
}

/**
 * サマリー用の imageUrl を決定する。
 * - data URL（Base64埋め込み）→ 専用配信API（キャッシュ可能・遅延読み込み）
 * - 通常のURL → そのまま
 */
function summaryImageUrl(article: SavedArticle): string {
  const url = article.imageUrl ?? ''
  if (!url) return ''
  if (url.startsWith('data:')) {
    // v は画像変更検知用（長さが変われば別画像とみなしキャッシュを分ける）
    return `/api/articles/image?id=${encodeURIComponent(article.id)}&v=${url.length}`
  }
  return url
}

export function toSummary(article: SavedArticle): ArticleSummary {
  const { originalContent: _oc, refinedContent: _rc, ...rest } = article
  return {
    ...rest,
    originalContent: '',
    refinedContent: '',
    imageUrl: summaryImageUrl(article),
    excerpt: buildExcerpt(article),
  }
}

async function loadSummaryIndex(): Promise<ArticleSummary[] | null> {
  const obj = await getS3ObjectAsText(SUMMARY_INDEX_KEY)
  if (!obj) return null
  try {
    const parsed = JSON.parse(obj.content)
    return Array.isArray(parsed) ? (parsed as ArticleSummary[]) : null
  } catch {
    return null
  }
}

async function saveSummaryIndex(entries: ArticleSummary[]): Promise<void> {
  await putS3Object(SUMMARY_INDEX_KEY, JSON.stringify(entries))
}

/** 全記事をスキャンしてサマリーインデックスを再構築する（インデックス欠損時の復旧用） */
export async function rebuildSummaryIndex(): Promise<ArticleSummary[]> {
  const objects = await listS3Objects(PREFIX)
  const jsonFiles = objects.filter(o => o.key.endsWith('.json') && o.key !== SUMMARY_INDEX_KEY)

  const results = await Promise.all(jsonFiles.map(obj => getS3ObjectAsText(obj.key)))
  const summaries: ArticleSummary[] = []
  for (const result of results) {
    if (!result) continue
    try {
      const article = JSON.parse(result.content) as SavedArticle
      if (article?.id) summaries.push(toSummary(article))
    } catch { /* skip malformed */ }
  }
  summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  await saveSummaryIndex(summaries)
  return summaries
}

/** 一覧用サマリーを取得（インデックスがなければ自動再構築） */
export async function getArticleSummaries(): Promise<ArticleSummary[]> {
  const index = await loadSummaryIndex()
  if (index) return index
  return rebuildSummaryIndex()
}

/** 単一記事のフルデータを取得 */
export async function getArticleFromS3(id: string): Promise<SavedArticle | null> {
  const result = await getS3ObjectAsText(articleKey(id))
  if (!result) return null
  try {
    return JSON.parse(result.content) as SavedArticle
  } catch {
    return null
  }
}

/** 記事を保存し、サマリーインデックスも同期する */
export async function saveArticleToS3(article: SavedArticle): Promise<boolean> {
  const ok = await putS3Object(articleKey(article.id), JSON.stringify(article))
  if (!ok) return false

  try {
    const index = (await loadSummaryIndex()) ?? (await rebuildSummaryIndex())
    const summary = toSummary(article)
    const next = index.filter(e => e.id !== article.id)
    next.push(summary)
    next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    await saveSummaryIndex(next)
  } catch (e) {
    console.warn('[ArticleIndex] サマリーインデックス更新失敗（記事保存は成功）:', e)
  }
  return true
}

/** 記事を削除し、サマリーインデックスも同期する */
export async function deleteArticleFromS3(id: string): Promise<boolean> {
  const ok = await deleteS3Object(articleKey(id))
  if (!ok) return false

  try {
    const index = await loadSummaryIndex()
    if (index) {
      await saveSummaryIndex(index.filter(e => e.id !== id))
    }
  } catch (e) {
    console.warn('[ArticleIndex] サマリーインデックス更新失敗（記事削除は成功）:', e)
  }
  return true
}
