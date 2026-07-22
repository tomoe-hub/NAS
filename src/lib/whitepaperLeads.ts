import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { getDynamoClient } from '@/lib/dynamodb/client'

export const WHITEPAPER_LEADS_TABLE =
  process.env.DYNAMODB_WHITEPAPER_LEADS_TABLE?.trim() || 'nts-whitepaper-leads'

export interface WhitepaperLead {
  email: string
  downloadedAt: string
  company: string
  considerationStatus: string
  name: string
  pdfTitle: string
  pdfVersion: string
  phone: string
}

export interface WhitepaperLeadSummary {
  total: number
  last30Days: number
  latestDownloadedAt: string | null
  statusCounts: Record<string, number>
  documentCounts: Record<string, number>
}

export interface WhitepaperLeadsResult {
  leads: WhitepaperLead[]
  summary: WhitepaperLeadSummary
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function normalizeLead(item: Record<string, unknown>): WhitepaperLead | null {
  const email = stringValue(item.email)
  const downloadedAt = stringValue(item.downloaded_at)
  if (!email || !downloadedAt) return null

  return {
    email,
    downloadedAt,
    company: stringValue(item.company),
    considerationStatus: stringValue(item.consideration_status),
    name: stringValue(item.name),
    pdfTitle: stringValue(item.pdf_title),
    pdfVersion: stringValue(item.pdf_version),
    phone: stringValue(item.phone),
  }
}

function parseDownloadedAt(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function buildSummary(leads: WhitepaperLead[]): WhitepaperLeadSummary {
  const cutoff = Date.now() - 30 * 86_400_000
  const statusCounts: Record<string, number> = {}
  const documentCounts: Record<string, number> = {}

  for (const lead of leads) {
    const status = lead.considerationStatus || '未回答'
    statusCounts[status] = (statusCounts[status] ?? 0) + 1

    const document = lead.pdfTitle || '資料名未設定'
    documentCounts[document] = (documentCounts[document] ?? 0) + 1
  }

  return {
    total: leads.length,
    last30Days: leads.filter(lead => parseDownloadedAt(lead.downloadedAt) >= cutoff).length,
    latestDownloadedAt: leads[0]?.downloadedAt ?? null,
    statusCounts,
    documentCounts,
  }
}

/**
 * ホワイトペーパーDLユーザーを全件取得する。
 * 現在は小規模テーブルだが、LastEvaluatedKeyを処理して将来の件数増加にも対応する。
 */
export async function loadWhitepaperLeads(): Promise<WhitepaperLeadsResult> {
  const dynamo = getDynamoClient()
  const rawItems: Record<string, unknown>[] = []
  let lastKey: Record<string, unknown> | undefined

  do {
    const response = await dynamo.send(new ScanCommand({
      TableName: WHITEPAPER_LEADS_TABLE,
      ExclusiveStartKey: lastKey,
      ProjectionExpression:
        'email, downloaded_at, company, consideration_status, #leadName, pdf_title, pdf_version, phone',
      ExpressionAttributeNames: {
        '#leadName': 'name',
      },
    }))

    for (const item of response.Items ?? []) {
      rawItems.push(item)
    }
    lastKey = response.LastEvaluatedKey
  } while (lastKey)

  const leads = rawItems
    .map(normalizeLead)
    .filter((lead): lead is WhitepaperLead => lead !== null)
    .sort((a, b) => parseDownloadedAt(b.downloadedAt) - parseDownloadedAt(a.downloadedAt))

  return { leads, summary: buildSummary(leads) }
}
