import { NextResponse } from 'next/server'
import { formatWordPressApiError, getWordPressConfig } from '@/lib/wordpress'

export const dynamic = 'force-dynamic'

/**
 * GET /api/wordpress/health
 * Vercel サーバーから WordPress 認証が通るかを診断する。
 * パスワード本体は返さない（文字数のみ）。
 */
export async function GET() {
  const config = getWordPressConfig()

  if (!config) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error: 'WORDPRESS_URL / WORDPRESS_USERNAME / WORDPRESS_APP_PASSWORD のいずれかが未設定です',
      },
      { status: 503 },
    )
  }

  const meUrl = `${config.wpUrl}/wp-json/wp/v2/users/me`

  try {
    const res = await fetch(meUrl, {
      headers: {
        Authorization: config.authorization,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      console.error('[wp/health] auth failed', res.status, JSON.stringify(errData))

      return NextResponse.json({
        ok: false,
        configured: true,
        wpUrl: config.wpUrl,
        username: config.username,
        passwordLength: config.appPassword.length,
        status: res.status,
        error: formatWordPressApiError(res.status, errData, res.statusText),
        hint:
          res.status === 403
            ? 'PCのPowerShellでは成功するのにここだけ403の場合、WordPressのセキュリティプラグインがVercelのIPをブロックしている可能性が高いです。SiteGuard等でREST API / 国外IPアクセスを確認してください。'
            : undefined,
      })
    }

    const user = (await res.json()) as { id?: number; name?: string; slug?: string }

    return NextResponse.json({
      ok: true,
      configured: true,
      wpUrl: config.wpUrl,
      username: config.username,
      passwordLength: config.appPassword.length,
      user: {
        id: user.id,
        name: user.name,
        slug: user.slug,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[wp/health] fetch error', message)
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        wpUrl: config.wpUrl,
        username: config.username,
        passwordLength: config.appPassword.length,
        error: message,
      },
      { status: 500 },
    )
  }
}
