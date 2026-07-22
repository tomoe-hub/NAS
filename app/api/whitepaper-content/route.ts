import { NextRequest, NextResponse } from 'next/server'
import {
  generateWhitepaperArticle,
  listWhitepaperContent,
  saveWhitepaperContentMeta,
  type WhitepaperContentMeta,
} from '@/lib/whitepaperContent'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

function stringField(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length <= maxLength ? text : null
}

function isAllowedDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      (url.hostname === 'nihon-teikei.co.jp' || url.hostname.endsWith('.nihon-teikei.co.jp'))
  } catch {
    return false
  }
}

async function parseMeta(body: Record<string, unknown>): Promise<Omit<WhitepaperContentMeta, 'updatedAt'> | null> {
  const s3Key = stringField(body.s3Key, 1_000)
  const title = stringField(body.title, 200)
  const description = stringField(body.description, 2_000)
  const downloadPageUrl = stringField(body.downloadPageUrl, 500)
  const targetKeyword = stringField(body.targetKeyword, 150)
  const thumbnailKey = stringField(body.thumbnailKey, 1_000)

  if (
    !s3Key ||
    !s3Key.startsWith('Whitepapers/') ||
    !s3Key.toLowerCase().endsWith('.pdf') ||
    !title ||
    description === null ||
    !downloadPageUrl ||
    !isAllowedDownloadUrl(downloadPageUrl) ||
    !targetKeyword ||
    thumbnailKey === null
  ) {
    return null
  }

  const items = await listWhitepaperContent()
  if (!items.some(item => item.s3Key === s3Key)) return null
  return { s3Key, title, description, downloadPageUrl, targetKeyword, thumbnailKey }
}

export async function GET() {
  try {
    return NextResponse.json({ items: await listWhitepaperContent() }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json(
      { error: 'S3のホワイトペーパー一覧を取得できませんでした。' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>
    const meta = await parseMeta(body)
    if (!meta) {
      return NextResponse.json(
        { error: '資料名・対象KW・日本提携支援のDLページURLを正しく入力してください。' },
        { status: 400 },
      )
    }

    if (body.action === 'save') {
      const saved = await saveWhitepaperContentMeta(meta)
      return NextResponse.json({ item: saved })
    }
    if (body.action === 'generate') {
      const result = await generateWhitepaperArticle(meta)
      return NextResponse.json(result)
    }
    return NextResponse.json({ error: '操作を識別できません。' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : '記事生成に失敗しました。'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
