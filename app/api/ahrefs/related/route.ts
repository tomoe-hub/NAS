import { NextRequest, NextResponse } from 'next/server'
import { findRelatedKeywords } from '@/lib/ahrefsLoader'

export const dynamic = 'force-dynamic'

export interface RelatedKeywordItem {
  keyword: string
  volume: number
  kd: number
  cpc: number
}

/**
 * GET /api/ahrefs/related?q=バリュエーション&limit=5
 * Ahrefsの最新データセットから、クエリを部分一致で含むKW候補を返す。
 * 記事分析ページの手薄カテゴリー → KW候補提示に使用。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()
  const limit = Math.min(10, Math.max(1, parseInt(searchParams.get('limit') || '5', 10) || 5))

  if (!q) {
    return NextResponse.json({ keywords: [] as RelatedKeywordItem[] })
  }

  try {
    const rows = await findRelatedKeywords(q, limit)
    const keywords: RelatedKeywordItem[] = rows.map(r => ({
      keyword: r.keyword,
      volume: r.volume ?? 0,
      kd: r.kd ?? 0,
      cpc: r.cpc ?? 0,
    }))
    return NextResponse.json({ keywords })
  } catch (e) {
    console.error('[ahrefs/related] error:', e)
    return NextResponse.json({ keywords: [] as RelatedKeywordItem[] })
  }
}
