import { NextRequest, NextResponse } from 'next/server'
import { listS3Objects, getS3ObjectAsText } from '@/lib/s3Reference'
import type { SavedArticle } from '@/lib/types'
import { upsertArticleEmbedding } from '@/lib/articleEmbeddings'
import {
  getArticleSummaries,
  getArticleFromS3,
  saveArticleToS3,
  deleteArticleFromS3,
} from '@/lib/articleServerStorage'

export const dynamic = 'force-dynamic'

const PREFIX = 'articles/'
const SUMMARY_INDEX_KEY = 'articles/summary-index.json'

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)

    // ?id=xxx → 単一記事を直接S3から取得（全件fetchを回避して高速化）
    const id = url.searchParams.get('id')
    if (id) {
      const article = await getArticleFromS3(id)
      if (!article) {
        return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 })
      }
      return NextResponse.json({ article })
    }

    // ?summary=1 → 一覧用の軽量サマリー（本文・Base64画像なし、S3取得1回）
    if (url.searchParams.get('summary') === '1') {
      const articles = await getArticleSummaries()
      return NextResponse.json({ articles })
    }

    // フル一覧（後方互換。重いので一覧ページでは summary=1 を使うこと）
    const objects = await listS3Objects(PREFIX)
    const jsonFiles = objects.filter(o => o.key.endsWith('.json') && o.key !== SUMMARY_INDEX_KEY)

    const results = await Promise.all(
      jsonFiles.map(obj => getS3ObjectAsText(obj.key))
    )

    const articles: SavedArticle[] = []
    for (const result of results) {
      if (result) {
        try {
          articles.push(JSON.parse(result.content) as SavedArticle)
        } catch { /* skip malformed */ }
      }
    }

    articles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return NextResponse.json({ articles })
  } catch (e) {
    console.error('Articles GET error:', e)
    return NextResponse.json({ error: '記事一覧の取得に失敗しました' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const article = (await request.json()) as SavedArticle
    if (!article.id) {
      return NextResponse.json({ error: '記事IDが必要です' }, { status: 400 })
    }

    const ok = await saveArticleToS3(article)
    if (!ok) {
      return NextResponse.json({ error: 'S3への保存に失敗しました。AWS環境変数を確認してください。' }, { status: 500 })
    }

    // 非同期でembedding生成（レスポンスをブロックしない）
    upsertArticleEmbedding(article).catch(e =>
      console.warn('[Embedding] 自動生成失敗（記事保存には影響なし）:', e)
    )

    return NextResponse.json({ success: true, id: article.id })
  } catch (e) {
    console.error('Articles POST error:', e)
    return NextResponse.json({ error: '記事の保存に失敗しました' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { id } = (await request.json()) as { id: string }
    if (!id) {
      return NextResponse.json({ error: '記事IDが必要です' }, { status: 400 })
    }

    const ok = await deleteArticleFromS3(id)
    if (!ok) {
      return NextResponse.json({ error: 'S3からの削除に失敗しました' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Articles DELETE error:', e)
    return NextResponse.json({ error: '記事の削除に失敗しました' }, { status: 500 })
  }
}
