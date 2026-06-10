import { NextRequest, NextResponse } from 'next/server'
import { listImages, saveImage, deleteImage } from '@/lib/imageLibrary'

/** GET /api/image-library — 画像一覧取得 */
export async function GET() {
  const images = await listImages()
  return NextResponse.json({ images })
}

/** POST /api/image-library — 画像をライブラリに追加 */
export async function POST(request: NextRequest) {
  let body: {
    imageBase64?: string
    mimeType?: string
    title?: string
    targetKeyword?: string
    articleId?: string
    prompt?: string
    source?: 'generated' | 'uploaded'
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSONが不正です' }, { status: 400 })
  }

  const { imageBase64, mimeType, title, targetKeyword, articleId, prompt, source } = body
  if (!imageBase64 || !title) {
    return NextResponse.json({ error: 'imageBase64 と title は必須です' }, { status: 400 })
  }

  const entry = await saveImage({
    imageBase64,
    mimeType: mimeType ?? 'image/jpeg',
    title,
    targetKeyword,
    articleId,
    prompt,
    source: source ?? 'generated',
  })

  if (!entry) {
    return NextResponse.json({ error: 'S3が設定されていません' }, { status: 500 })
  }

  return NextResponse.json({ entry })
}

/** DELETE /api/image-library?id=xxx — 画像削除 */
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id が必要です' }, { status: 400 })
  }
  const ok = await deleteImage(id)
  if (!ok) {
    return NextResponse.json({ error: '削除対象が見つかりません' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
