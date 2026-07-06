import { NextRequest, NextResponse } from 'next/server'
import { getArticleFromS3 } from '@/lib/articleServerStorage'

export const dynamic = 'force-dynamic'

/**
 * GET /api/articles/image?id=xxx
 * 記事JSONに埋め込まれた Base64 画像（data URL）をバイナリで配信する。
 * 一覧ページのサムネイル用。強めのブラウザキャッシュを付けて再取得を防ぐ。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id が必要です' }, { status: 400 })
  }

  const article = await getArticleFromS3(id)
  const imageUrl = article?.imageUrl ?? ''

  if (!imageUrl) {
    return NextResponse.json({ error: '画像がありません' }, { status: 404 })
  }

  // 通常URLの場合はリダイレクト
  if (!imageUrl.startsWith('data:')) {
    return NextResponse.redirect(imageUrl)
  }

  const matches = imageUrl.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/)
  if (!matches) {
    return NextResponse.json({ error: '画像データが不正です' }, { status: 500 })
  }

  const [, mimeType, base64] = matches
  const buffer = Buffer.from(base64!, 'base64')

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': mimeType!,
      'Content-Length': String(buffer.length),
      // 記事画像は実質不変（変更時は ?v= が変わる）なので長期キャッシュ
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  })
}
