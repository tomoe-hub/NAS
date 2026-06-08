/**
 * 過去記事 Embedding RAG
 *
 * - Gemini text-embedding-004 で記事をベクトル化
 * - S3 に index.json として保存（article-embeddings/index.json）
 * - 新規記事生成時にコサイン類似度で上位K件を取得し、文体参考として返す
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import { listS3Objects } from '@/lib/s3Reference'
import type { SavedArticle } from '@/lib/types'

const EMBEDDING_KEY = 'article-embeddings/index.json'
const EMBEDDING_MODEL = 'text-embedding-004'

// ── 型定義 ──────────────────────────────────────────────

interface EmbeddingEntry {
  vector: number[]
  title: string
  keyword: string
  excerpt: string
  headings: string[]
  embeddedAt: string
}

type EmbeddingIndex = Record<string, EmbeddingEntry>

export interface SimilarArticle {
  id: string
  title: string
  keyword: string
  excerpt: string
  headings: string[]
  score: number
}

// ── 内部ユーティリティ ────────────────────────────────

/** 本文から H2 見出し行（「1. テキスト」形式）を抽出する */
function extractH2Headings(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+[．.]\s/.test(line))
    .map(line => line.replace(/^\d+[．.]\s*/, '').trim())
    .filter(Boolean)
}

/** Gemini Embedding API でテキストをベクトル化 */
export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) throw new Error('GEMINI_API_KEY が設定されていません')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL })
  const result = await model.embedContent(text)
  return result.embedding.values
}

/** コサイン類似度（-1 〜 1、高いほど類似） */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** S3 から EmbeddingIndex を読み込む（存在しない場合は空オブジェクト） */
async function loadIndex(): Promise<EmbeddingIndex> {
  const result = await getS3ObjectAsText(EMBEDDING_KEY)
  if (!result) return {}
  try {
    return JSON.parse(result.content) as EmbeddingIndex
  } catch {
    return {}
  }
}

/** EmbeddingIndex を S3 に書き込む */
async function saveIndex(index: EmbeddingIndex): Promise<boolean> {
  return putS3Object(EMBEDDING_KEY, JSON.stringify(index), 'application/json')
}

// ── 公開 API ────────────────────────────────────────────

/**
 * クエリベクトルに対してコサイン類似度が高い上位 K 件の記事を返す。
 * embeddingIndex が空の場合は空配列を返す。
 */
export async function findSimilarArticles(
  queryVector: number[],
  k = 3,
): Promise<SimilarArticle[]> {
  const index = await loadIndex()
  const entries = Object.entries(index)
  if (entries.length === 0) return []

  const scored = entries.map(([id, entry]) => ({
    id,
    title:    entry.title,
    keyword:  entry.keyword,
    excerpt:  entry.excerpt,
    headings: entry.headings ?? [],
    score:    cosineSimilarity(queryVector, entry.vector),
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}

/**
 * 記事 1 件の embedding を生成して S3 index に upsert する。
 * 既にベクトル化済みの場合はスキップ（force=true で強制再生成）。
 */
export async function upsertArticleEmbedding(
  article: SavedArticle,
  force = false,
): Promise<'done' | 'skipped' | 'failed'> {
  try {
    const index = await loadIndex()

    if (!force && index[article.id]) {
      return 'skipped'
    }

    const body = article.refinedContent || article.originalContent || ''
    if (!body.trim()) return 'skipped'

    const inputText = [
      article.refinedTitle || article.title,
      article.targetKeyword,
      body.slice(0, 1000),
    ]
      .filter(Boolean)
      .join(' ')

    const vector = await embedText(inputText)

    index[article.id] = {
      vector,
      title:      article.refinedTitle || article.title,
      keyword:    article.targetKeyword || '',
      excerpt:    body.slice(0, 400),
      headings:   extractH2Headings(body),
      embeddedAt: new Date().toISOString(),
    }

    const ok = await saveIndex(index)
    return ok ? 'done' : 'failed'
  } catch (e) {
    console.error('[Embedding] upsertArticleEmbedding 失敗:', e)
    return 'failed'
  }
}

/**
 * S3 の articles/ プレフィックス下にある全記事をバッチでベクトル化する。
 * limit で 1 回のリクエストで処理する最大件数を制限（Vercel timeout 対策）。
 * 既にベクトル化済みの記事はスキップ。
 */
export async function batchEmbedArticles(limit = 10): Promise<{
  done: number
  skipped: number
  failed: number
  remaining: number
}> {
  const result = { done: 0, skipped: 0, failed: 0, remaining: 0 }

  // 既存インデックスを読み込んで、未処理の記事を特定
  const [index, objects] = await Promise.all([
    loadIndex(),
    listS3Objects('articles/'),
  ])

  const jsonFiles = objects.filter(o => o.key.endsWith('.json'))
  const unprocessed: string[] = []

  for (const obj of jsonFiles) {
    const id = obj.key.replace('articles/', '').replace('.json', '')
    if (!index[id]) {
      unprocessed.push(obj.key)
    }
  }

  result.remaining = Math.max(0, unprocessed.length - limit)

  // limit 件だけ処理
  const batch = unprocessed.slice(0, limit)

  const { getS3ObjectAsText: getObj } = await import('@/lib/s3Reference')

  for (const key of batch) {
    try {
      const raw = await getObj(key)
      if (!raw) { result.skipped++; continue }
      const article = JSON.parse(raw.content) as SavedArticle
      const status = await upsertArticleEmbedding(article, false)
      result[status]++
    } catch {
      result.failed++
    }
  }

  return result
}
