import { NextResponse } from 'next/server'
import { loadWhitepaperLeads } from '@/lib/whitepaperLeads'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function publicErrorMessage(error: unknown): string {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String(error.name)
      : ''

  if (name === 'ResourceNotFoundException') {
    return 'ホワイトペーパーテーブルが見つかりません。テーブル名とリージョンを確認してください。'
  }
  if (name === 'AccessDeniedException') {
    return 'DynamoDBの読み取り権限がありません。VercelのAWS認証情報とIAM権限を確認してください。'
  }
  if (
    name === 'CredentialsProviderError' ||
    name === 'UnrecognizedClientException' ||
    name === 'InvalidSignatureException'
  ) {
    return 'AWS認証に失敗しました。AWSアクセスキーの設定を確認してください。'
  }
  return 'ホワイトペーパーのダウンロードデータを取得できませんでした。'
}

export async function GET() {
  try {
    const result = await loadWhitepaperLeads()
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    // 個人情報を含む可能性があるため、DynamoDBレスポンスやItem自体はログに出さない。
    const errorName =
      error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : 'UnknownError'
    console.error('[Whitepaper leads] DynamoDB read failed:', errorName)
    return NextResponse.json(
      { error: publicErrorMessage(error) },
      { status: 500 },
    )
  }
}
