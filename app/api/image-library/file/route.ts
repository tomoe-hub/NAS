import { NextRequest, NextResponse } from 'next/server'
import { getImageFile } from '@/lib/imageLibrary'

/** GET /api/image-library/file?id=xxx — S3の画像バイナリを配信（非公開バケット対応） */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id が必要です' }, { status: 400 })
  }

  const file = await getImageFile(id)
  if (!file) {
    return NextResponse.json({ error: '画像が見つかりません' }, { status: 404 })
  }

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
