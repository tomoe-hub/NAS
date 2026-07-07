/**
 * SEO分析用API（GA4 / Search Console）の疎通確認スクリプト。
 *
 * 使い方:
 *   1. .env.local に GOOGLE_SERVICE_ACCOUNT_JSON / GA4_PROPERTY_ID / GSC_PROPERTY_URL を設定
 *   2. node scripts/test-seo-api-connection.mjs
 */
import { google } from 'googleapis'
import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')
const envContent = readFileSync(envPath, 'utf-8')

function parseEnvValue(key) {
  const match = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return match ? match[1].trim() : null
}

const rawCreds = parseEnvValue('GOOGLE_SERVICE_ACCOUNT_JSON')
const gscUrl = parseEnvValue('GSC_PROPERTY_URL')
const ga4Id = parseEnvValue('GA4_PROPERTY_ID')

if (!rawCreds) {
  console.error('GOOGLE_SERVICE_ACCOUNT_JSON が .env.local にありません')
  process.exit(1)
}
const creds = JSON.parse(rawCreds)

const end = new Date().toISOString().slice(0, 10)
const start = new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10)

console.log('--- NAS SEO API Connection Test ---')
console.log(`Service Account: ${creds.client_email}`)
console.log(`GSC Property: ${gscUrl}`)
console.log(`GA4 Property: ${ga4Id}`)
console.log(`Period: ${start} - ${end}`)
console.log()

// Test GSC
console.log('[1/2] Testing Search Console API...')
if (!gscUrl) {
  console.log('  SKIPPED - GSC_PROPERTY_URL が未設定')
} else {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    })
    const webmasters = google.searchconsole({ version: 'v1', auth })
    const res = await webmasters.searchanalytics.query({
      siteUrl: gscUrl,
      requestBody: {
        startDate: start,
        endDate: end,
        dimensions: ['date'],
        rowLimit: 5,
        dataState: 'all',
      },
    })
    const rows = res.data.rows ?? []
    console.log(`  OK - ${rows.length} rows returned`)
    if (rows.length > 0) {
      console.log(`  Sample: ${JSON.stringify(rows[0])}`)
    }
  } catch (e) {
    console.error(`  FAILED: ${e.message}`)
  }
}

console.log()

// Test GA4
console.log('[2/2] Testing Google Analytics 4 Data API...')
if (!ga4Id) {
  console.log('  SKIPPED - GA4_PROPERTY_ID が未設定')
} else {
  try {
    const client = new BetaAnalyticsDataClient({ credentials: creds })
    const [resp] = await client.runReport({
      property: `properties/${ga4Id}`,
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      limit: 5,
    })
    const rows = resp.rows ?? []
    console.log(`  OK - ${rows.length} rows returned`)
    if (rows.length > 0) {
      const dim = rows[0].dimensionValues ?? []
      const met = rows[0].metricValues ?? []
      console.log(`  Sample: date=${dim[0]?.value}, sessions=${met[0]?.value}, users=${met[1]?.value}`)
    }
  } catch (e) {
    console.error(`  FAILED: ${e.message}`)
  }
}

console.log()
console.log('--- Test Complete ---')
