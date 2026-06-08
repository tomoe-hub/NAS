import { NextRequest, NextResponse } from 'next/server'
import { batchEmbedArticles, upsertArticleEmbedding } from '@/lib/articleEmbeddings'
import { getS3ObjectAsText } from '@/lib/s3Reference'
import type { SavedArticle } from '@/lib/types'

export const maxDuration = 120

/**
 * POST /api/articles/embeddings
 *
 * body: { mode: 'all', limit?: number }   → バッチ処理（未処理のものを最大 limit 件）
 * body: { mode: 'single', articleId: string } → 1件処理
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as
      | { mode: 'all'; limit?: number }
      | { mode: 'single'; articleId: string }

    if (body.mode === 'single') {
      const key = `articles/${body.articleId}.json`
      const raw = await getS3ObjectAsText(key)
      if (!raw) {
        return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 })
      }
      const article = JSON.parse(raw.content) as SavedArticle
      const status = await upsertArticleEmbedding(article, true)
      return NextResponse.json({ done: status === 'done' ? 1 : 0, skipped: status === 'skipped' ? 1 : 0, failed: status === 'failed' ? 1 : 0, remaining: 0 })
    }

    // mode: 'all'
    const limit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : 10
    const result = await batchEmbedArticles(limit)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[Embeddings API] error:', e)
    const message = e instanceof Error ? e.message : 'ベクトル化に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
