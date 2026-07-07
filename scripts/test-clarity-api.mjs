/**
 * Microsoft Clarity Data Export API の疎通確認スクリプト。
 *
 * 使い方:
 *   1. .env.local に CLARITY_API_TOKEN / CLARITY_PROJECT_ID を設定
 *   2. node scripts/test-clarity-api.mjs
 */
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

const token = parseEnvValue('CLARITY_API_TOKEN')
const clarityPid = parseEnvValue('CLARITY_PROJECT_ID')

console.log('--- Clarity API Connection Test ---')
console.log(`Project ID: ${clarityPid}`)
console.log(`Token (first 40): ${token?.slice(0, 40)}...`)
console.log()

if (!token) {
  console.error('CLARITY_API_TOKEN が .env.local にありません')
  process.exit(1)
}

const url = new URL('https://www.clarity.ms/export-data/api/v1/project-live-insights')
url.searchParams.set('numOfDays', '1')

console.log(`Fetching: ${url}`)
const res = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
})

console.log(`Status: ${res.status} ${res.statusText}`)

if (!res.ok) {
  const text = await res.text().catch(() => '')
  console.error(`FAILED: ${text.slice(0, 500)}`)
  process.exit(1)
}

const json = await res.json()
const entries = Array.isArray(json) ? json : json.metrics ?? []
console.log(`Metric entries: ${entries.length}`)
for (const e of entries) {
  console.log(`\n--- ${e.metricName} ---`)
  console.log(JSON.stringify(e, null, 2).slice(0, 600))
}
console.log()
console.log('--- Test Complete ---')
