import { SavedArticle } from './types'

const API_BASE = '/api/articles'

/** 一覧用サマリー（本文は空・excerpt 付き。imageUrl は配信APIのURL） */
export type ArticleSummaryItem = SavedArticle & { excerpt?: string }

const SUMMARY_CACHE_KEY = 'nas_article_summaries_v1'

export async function getAllArticles(): Promise<SavedArticle[]> {
  try {
    const res = await fetch(API_BASE)
    if (!res.ok) throw new Error(`GET ${res.status}`)
    const data = await res.json()
    return data.articles ?? []
  } catch (e) {
    console.error('getAllArticles error:', e)
    return []
  }
}

/**
 * 一覧用の軽量サマリーを取得（本文・Base64画像を含まないため高速）。
 * 取得結果は sessionStorage にキャッシュし、次回の初期表示に使う。
 */
export async function fetchArticleSummaries(): Promise<ArticleSummaryItem[]> {
  try {
    const res = await fetch(`${API_BASE}?summary=1`)
    if (!res.ok) throw new Error(`GET ${res.status}`)
    const data = await res.json()
    const articles: ArticleSummaryItem[] = data.articles ?? []
    try {
      sessionStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(articles))
    } catch { /* 容量超過などは無視（キャッシュなしで動作継続） */ }
    return articles
  } catch (e) {
    console.error('fetchArticleSummaries error:', e)
    return []
  }
}

/** sessionStorage のサマリーキャッシュを読む（初期表示の高速化用） */
export function readSummariesCache(): ArticleSummaryItem[] | null {
  try {
    const raw = sessionStorage.getItem(SUMMARY_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ArticleSummaryItem[]) : null
  } catch {
    return null
  }
}

/** 保存・削除後にキャッシュを無効化する */
export function invalidateSummariesCache(): void {
  try {
    sessionStorage.removeItem(SUMMARY_CACHE_KEY)
  } catch { /* noop */ }
}

export async function saveArticle(article: SavedArticle): Promise<void> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(article),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || '記事の保存に失敗しました')
  }
  invalidateSummariesCache()
}

export async function deleteArticle(id: string): Promise<void> {
  const res = await fetch(API_BASE, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || '記事の削除に失敗しました')
  }
  invalidateSummariesCache()
}

export async function getArticleById(id: string): Promise<SavedArticle | null> {
  try {
    const res = await fetch(`${API_BASE}?id=${encodeURIComponent(id)}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GET ${res.status}`)
    const data = await res.json() as { article?: SavedArticle }
    return data.article ?? null
  } catch (e) {
    console.error('getArticleById error:', e)
    return null
  }
}

export async function updateArticleStatus(
  id: string,
  status: SavedArticle['status'],
  wordpressUrl?: string,
  wordpressPostStatus?: string,
  wordpressPublishedAt?: string
): Promise<void> {
  const article = await getArticleById(id)
  if (!article) return
  article.status = status
  if (wordpressUrl) article.wordpressUrl = wordpressUrl
  if (wordpressPostStatus !== undefined) article.wordpressPostStatus = wordpressPostStatus
  if (wordpressPublishedAt?.trim()) article.wordpressPublishedAt = wordpressPublishedAt.trim()
  await saveArticle(article)
}
