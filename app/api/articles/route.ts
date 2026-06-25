import { NextRequest, NextResponse } from 'next/server'
import { listS3Objects, getS3ObjectAsText, putS3Object, deleteS3Object } from '@/lib/s3Reference'
import type { SavedArticle } from '@/lib/types'
import { upsertArticleEmbedding } from '@/lib/articleEmbeddings'

export const dynamic = 'force-dynamic'

const PREFIX = 'articles/'

function articleKey(id: string): string {
  return `${PREFIX}${id}.json`
}

export async function GET(request: NextRequest) {
  try {
    // ?id=xxx → 単一記事を直接S3から取得（全件fetchを回避して高速化）
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (id) {
      const result = await getS3ObjectAsText(articleKey(id))
      if (!result) {
        return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 })
      }
      try {
        const article = JSON.parse(result.content) as SavedArticle
        return NextResponse.json({ article })
      } catch {
        return NextResponse.json({ error: '記事データの読み込みに失敗しました' }, { status: 500 })
      }
    }

    // id 未指定 → 全件一覧（並列リクエストで高速化）
    const objects = await listS3Objects(PREFIX)
    const jsonFiles = objects.filter(o => o.key.endsWith('.json'))

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

    const ok = await putS3Object(articleKey(article.id), JSON.stringify(article))
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

    const ok = await deleteS3Object(articleKey(id))
    if (!ok) {
      return NextResponse.json({ error: 'S3からの削除に失敗しました' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Articles DELETE error:', e)
    return NextResponse.json({ error: '記事の削除に失敗しました' }, { status: 500 })
  }
}
