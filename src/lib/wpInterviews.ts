/**
 * WordPress から「M&A成約インタビュー」記事を取得する（サーバー専用）。
 *
 * 仮説ペルソナ生成の一次データとして使用する。
 * Application Password 認証で取得するため、非公開（private）の
 * インタビュー記事も含めて収集できる。
 */

import { getWordPressConfig } from '@/lib/wordpress'

/** インタビュー記事をタイトルで特定するための検索語 */
const INTERVIEW_SEARCH_TERM = '成約インタビュー'

export interface InterviewPost {
  id: number
  title: string
  /** HTMLタグ除去済みの本文テキスト */
  text: string
  link: string
  date: string
  status: string
}

interface WpPostRow {
  id: number
  date: string
  link: string
  status: string
  title?: { rendered?: string }
  content?: { rendered?: string }
}

/** HTMLをプレーンテキスト化する（script/style除去 → タグ除去 → エンティティ復元） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 「M&A成約インタビュー」記事を全件取得する（公開・非公開とも）。
 * 取得失敗時は空配列（呼び出し側でデータ不足として扱う）。
 */
export async function fetchInterviewPosts(): Promise<InterviewPost[]> {
  const config = getWordPressConfig()
  if (!config) {
    console.warn('[Interviews] WordPress設定が未構成のため取得をスキップ')
    return []
  }

  const results: InterviewPost[] = []

  // 認証付きで publish / private の両方を検索
  for (const status of ['publish', 'private']) {
    try {
      const url =
        `${config.wpUrl}/wp-json/wp/v2/posts` +
        `?search=${encodeURIComponent(INTERVIEW_SEARCH_TERM)}` +
        `&status=${status}&per_page=50&orderby=date&order=desc` +
        `&_fields=id,date,link,status,title,content`
      const res = await fetch(url, {
        headers: { Authorization: config.authorization, Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!res.ok) {
        console.warn(`[Interviews] 取得失敗 status=${status}: HTTP ${res.status}`)
        continue
      }
      const rows = (await res.json()) as WpPostRow[]
      for (const row of rows) {
        const title = htmlToText(row.title?.rendered ?? '')
        // 検索は本文にもマッチするため、タイトルにインタビューを含む記事に限定
        if (!title.includes('インタビュー')) continue
        results.push({
          id: row.id,
          title,
          text: htmlToText(row.content?.rendered ?? ''),
          link: row.link,
          date: row.date,
          status: row.status,
        })
      }
    } catch (e) {
      console.warn(`[Interviews] 取得エラー status=${status}:`, e)
    }
  }

  // id 重複を除去して日付降順
  const seen = new Set<number>()
  return results
    .filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .sort((a, b) => b.date.localeCompare(a.date))
}
