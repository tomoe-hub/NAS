/**
 * GET  /api/personas … 保存済みの仮説ペルソナを返す（未生成なら document: null）
 * POST /api/personas … インタビュー・事例・Ahrefsデータから再生成してS3に保存
 */

import { NextResponse } from 'next/server'
import { loadPersonaDocument, generatePersonaDocument } from '@/lib/personaGeneration'

export const dynamic = 'force-dynamic'
/** インタビュー取得＋AI生成で時間がかかるため（Proプラン上限） */
export const maxDuration = 300

export async function GET() {
  try {
    const document = await loadPersonaDocument()
    return NextResponse.json({ document })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'ペルソナの読み込みに失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST() {
  try {
    const document = await generatePersonaDocument()
    return NextResponse.json({ document })
  } catch (e) {
    console.error('[Persona] 生成エラー:', e)
    const message = e instanceof Error ? e.message : 'ペルソナの生成に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
