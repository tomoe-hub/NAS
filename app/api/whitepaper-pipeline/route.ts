import { NextRequest, NextResponse } from 'next/server'
import {
  buildWhitepaperLeadId,
  deleteWhitepaperPipeline,
  isPipelineStage,
  loadWhitepaperPipeline,
  updateWhitepaperPipeline,
} from '@/lib/whitepaperPipeline'
import { deleteWhitepaperLead } from '@/lib/whitepaperLeads'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function stringField(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length <= maxLength ? trimmed : null
}

function dateField(value: unknown): string | null {
  if (value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return value
}

export async function GET() {
  try {
    return NextResponse.json(await loadWhitepaperPipeline(), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json(
      { error: 'パイプライン情報を取得できませんでした。DynamoDBとS3の接続設定を確認してください。' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>
    const leadId = stringField(body.leadId, 600)
    const owner = stringField(body.owner, 100)
    const lastFollowedUpAt = dateField(body.lastFollowedUpAt)
    const nextActionAt = dateField(body.nextActionAt)
    const notes = stringField(body.notes, 5_000)

    if (
      !leadId ||
      !isPipelineStage(body.stage) ||
      owner === null ||
      lastFollowedUpAt === null ||
      nextActionAt === null ||
      notes === null
    ) {
      return NextResponse.json({ error: '入力内容が正しくありません。' }, { status: 400 })
    }

    const separatorIndex = leadId.lastIndexOf('::')
    const validLeadId = separatorIndex > 0 && buildWhitepaperLeadId(
      leadId.slice(0, separatorIndex),
      leadId.slice(separatorIndex + 2),
    ) === leadId
    if (!validLeadId) {
      return NextResponse.json({ error: '対象ユーザーを識別できません。' }, { status: 400 })
    }

    const record = await updateWhitepaperPipeline(leadId, {
      stage: body.stage,
      owner,
      lastFollowedUpAt,
      nextActionAt,
      notes,
    })
    return NextResponse.json({ record })
  } catch {
    return NextResponse.json(
      { error: 'パイプライン情報を保存できませんでした。' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>
    const leadId = stringField(body.leadId, 600)
    if (!leadId) {
      return NextResponse.json({ error: '対象ユーザーを識別できません。' }, { status: 400 })
    }

    const separatorIndex = leadId.lastIndexOf('::')
    if (separatorIndex <= 0) {
      return NextResponse.json({ error: '対象ユーザーを識別できません。' }, { status: 400 })
    }

    const email = leadId.slice(0, separatorIndex)
    const downloadedAt = leadId.slice(separatorIndex + 2)
    if (buildWhitepaperLeadId(email, downloadedAt) !== leadId) {
      return NextResponse.json({ error: '対象ユーザーを識別できません。' }, { status: 400 })
    }

    await deleteWhitepaperLead(email, downloadedAt)
    await deleteWhitepaperPipeline(leadId)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: 'DL履歴を削除できませんでした。DynamoDBの削除権限を確認してください。' },
      { status: 500 },
    )
  }
}
