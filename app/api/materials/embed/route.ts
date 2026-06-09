import { NextRequest, NextResponse } from 'next/server'
import { batchEmbedMaterials } from '@/lib/materialEmbeddings'

export const maxDuration = 120

/**
 * POST /api/materials/embed
 * body: { force?: boolean }
 *
 * materials_for_articles/ 下の全資料をチャンク化・ベクトル化してインデックスを更新する。
 * force=true で全ファイルを強制再インデックス。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const force = body?.force === true

    const result = await batchEmbedMaterials(force)

    return NextResponse.json({
      success: true,
      done:        result.done,
      skipped:     result.skipped,
      failed:      result.failed,
      chunksAdded: result.chunksAdded,
      message: `${result.done} ファイル処理完了、${result.chunksAdded} チャンク追加、${result.skipped} スキップ、${result.failed} 失敗`,
    })
  } catch (error) {
    console.error('[/api/materials/embed] エラー:', error)
    const message = error instanceof Error ? error.message : '資料のベクトル化に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
