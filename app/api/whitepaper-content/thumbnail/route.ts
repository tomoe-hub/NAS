import { NextRequest, NextResponse } from 'next/server'
import { getS3ObjectAsBuffer } from '@/lib/s3Reference'

const WHITEPAPER_BUCKET =
  process.env.WHITEPAPER_S3_BUCKET_NAME?.trim() || 'data-for-nas'

const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/i

/**
 * 非公開S3にあるホワイトペーパー表紙を、認証済みの管理画面だけへ配信する。
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key')?.trim() ?? ''
  if (
    !key.startsWith('Whitepapers/') ||
    !IMAGE_EXTENSIONS.test(key) ||
    key.includes('..')
  ) {
    return NextResponse.json({ error: '画像キーが不正です。' }, { status: 400 })
  }

  try {
    const result = await getS3ObjectAsBuffer(key, WHITEPAPER_BUCKET)
    if (!result) return new NextResponse(null, { status: 404 })

    return new NextResponse(Buffer.from(result.body), {
      headers: {
        'Content-Type': result.contentType ?? 'image/png',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return new NextResponse(null, { status: 502 })
  }
}
