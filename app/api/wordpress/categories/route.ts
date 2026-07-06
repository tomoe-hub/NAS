import { NextRequest, NextResponse } from 'next/server'
import { decodeHtmlEntities } from '@/lib/wpTagList'
import { formatWordPressApiError, getWordPressConfig } from '@/lib/wordpress'

export const dynamic = 'force-dynamic'

export interface WpCategoryListItem {
  id: number
  name: string
  slug: string
  count?: number
  parent?: number
}

/**
 * GET /api/wordpress/categories?per_page=100&page=1
 * WordPress のカテゴリーを使用回数降順で取得（記事分析ページ用）。
 */
export async function GET(request: NextRequest) {
  const config = getWordPressConfig()

  if (!config) {
    return NextResponse.json(
      {
        error: 'WordPress の環境変数（WORDPRESS_URL 等）が設定されていません',
        categories: [] as WpCategoryListItem[],
      },
      { status: 503 }
    )
  }

  const { searchParams } = new URL(request.url)
  const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get('per_page') || '100', 10) || 100))
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)

  const url = `${config.wpUrl}/wp-json/wp/v2/categories?per_page=${perPage}&page=${page}&orderby=count&order=desc&_fields=id,name,slug,count,parent`

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: config.authorization,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const errText = JSON.stringify(errData).slice(0, 500)
      console.error('[wp/categories]', res.status, errText)
      return NextResponse.json(
        {
          error: formatWordPressApiError(res.status, errData, `カテゴリー一覧の取得に失敗 (${res.status})`),
          categories: [] as WpCategoryListItem[],
        },
        { status: 502 }
      )
    }

    const rows = (await res.json()) as WpCategoryListItem[]
    const total = res.headers.get('X-WP-Total')
    const totalPages = res.headers.get('X-WP-TotalPages')

    const categories: WpCategoryListItem[] = Array.isArray(rows)
      ? rows.map(c => ({ ...c, name: decodeHtmlEntities(String(c.name ?? '')) }))
      : []

    return NextResponse.json({
      categories,
      total: total ? parseInt(total, 10) : undefined,
      totalPages: totalPages ? parseInt(totalPages, 10) : undefined,
    })
  } catch (e) {
    console.error('[wp/categories] fetch error', e)
    return NextResponse.json(
      { error: 'WordPress カテゴリー一覧の取得中にエラーが発生しました', categories: [] as WpCategoryListItem[] },
      { status: 500 }
    )
  }
}
