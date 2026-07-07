import type { JWTInput } from 'google-auth-library'

export type CredentialLoadResult =
  | { ok: true; creds: JWTInput }
  | { ok: false; reason: 'missing_env' | 'invalid_json'; message: string }

/**
 * 環境変数 GOOGLE_SERVICE_ACCOUNT_JSON を読み込む。
 * ローカル開発では GOOGLE_APPLICATION_CREDENTIALS（ファイルパス）も参照する。
 * 本番（Vercel）は必ず GOOGLE_SERVICE_ACCOUNT_JSON を使うこと。
 */
export function loadServiceAccountCredentials(): CredentialLoadResult {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (raw) {
    try {
      return { ok: true, creds: JSON.parse(raw) as JWTInput }
    } catch {
      return {
        ok: false,
        reason: 'invalid_json',
        message: 'GOOGLE_SERVICE_ACCOUNT_JSON が設定されていますが JSON として解析できません。改行や不正な文字がないか確認してください。',
      }
    }
  }

  // ローカル開発: ファイルパスによる読み込み
  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (filePath && process.env.NODE_ENV !== 'production') {
    try {
      const fs = require('fs') as { readFileSync: (p: string, enc: string) => string }
      const content = fs.readFileSync(filePath, 'utf8')
      return { ok: true, creds: JSON.parse(content) as JWTInput }
    } catch {
      return {
        ok: false,
        reason: 'invalid_json',
        message: `GOOGLE_APPLICATION_CREDENTIALS のファイル "${filePath}" を読み込めませんでした。`,
      }
    }
  }

  return {
    ok: false,
    reason: 'missing_env',
    message: 'GOOGLE_SERVICE_ACCOUNT_JSON が未設定です。GA4・Search Console のデータを取得できません。',
  }
}
