import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import { loadWhitepaperLeads, type WhitepaperLead } from '@/lib/whitepaperLeads'

const PIPELINE_KEY = 'whitepaper-pipeline/records.json'

export const PIPELINE_STAGES = [
  'new',
  'contacted',
  'meeting',
  'nurturing',
  'won',
  'lost',
] as const

export type PipelineStage = (typeof PIPELINE_STAGES)[number]

export const PIPELINE_STAGE_META: Record<PipelineStage, {
  label: string
  terminal: boolean
}> = {
  new: { label: '新規', terminal: false },
  contacted: { label: '接触済み', terminal: false },
  meeting: { label: 'ヒアリング・商談', terminal: false },
  nurturing: { label: '提案・追客', terminal: false },
  won: { label: '受注', terminal: true },
  lost: { label: '失注・対象外', terminal: true },
}

export interface WhitepaperPipelineRecord {
  leadId: string
  stage: PipelineStage
  owner: string
  lastFollowedUpAt: string
  nextActionAt: string
  notes: string
  updatedAt: string
}

export interface WhitepaperPipelineLead extends WhitepaperLead {
  leadId: string
  pipeline: WhitepaperPipelineRecord
}

export interface WhitepaperPipelineSummary {
  total: number
  pending: number
  overdue: number
  dueToday: number
  stageCounts: Record<PipelineStage, number>
}

export function buildWhitepaperLeadId(email: string, downloadedAt: string): string {
  return `${email.trim().toLocaleLowerCase('en-US')}::${downloadedAt.trim()}`
}

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === 'string' && PIPELINE_STAGES.includes(value as PipelineStage)
}

function defaultPipeline(leadId: string): WhitepaperPipelineRecord {
  return {
    leadId,
    stage: 'new',
    owner: '',
    lastFollowedUpAt: '',
    nextActionAt: '',
    notes: '',
    updatedAt: '',
  }
}

function datePart(value: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value)
  return match?.[0] ?? ''
}

export function isOverdue(record: WhitepaperPipelineRecord, today = new Date()): boolean {
  if (PIPELINE_STAGE_META[record.stage].terminal || !record.nextActionAt) return false
  const date = datePart(record.nextActionAt)
  if (!date) return false
  const todayPart = today.toISOString().slice(0, 10)
  return date < todayPart
}

export function isDueToday(record: WhitepaperPipelineRecord, today = new Date()): boolean {
  if (PIPELINE_STAGE_META[record.stage].terminal || !record.nextActionAt) return false
  return datePart(record.nextActionAt) === today.toISOString().slice(0, 10)
}

async function loadRecords(): Promise<Record<string, WhitepaperPipelineRecord>> {
  const object = await getS3ObjectAsText(PIPELINE_KEY)
  if (!object) return {}
  try {
    const parsed = JSON.parse(object.content) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const records: Record<string, WhitepaperPipelineRecord> = {}
    for (const [leadId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const record = value as Partial<WhitepaperPipelineRecord>
      if (!isPipelineStage(record.stage)) continue
      records[leadId] = {
        leadId,
        stage: record.stage,
        owner: typeof record.owner === 'string' ? record.owner : '',
        lastFollowedUpAt: typeof record.lastFollowedUpAt === 'string' ? record.lastFollowedUpAt : '',
        nextActionAt: typeof record.nextActionAt === 'string' ? record.nextActionAt : '',
        notes: typeof record.notes === 'string' ? record.notes : '',
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      }
    }
    return records
  } catch {
    return {}
  }
}

async function saveRecords(records: Record<string, WhitepaperPipelineRecord>): Promise<void> {
  const saved = await putS3Object(PIPELINE_KEY, JSON.stringify(records, null, 2))
  if (!saved) throw new Error('パイプライン情報の保存に失敗しました')
}

export async function loadWhitepaperPipeline(): Promise<{
  leads: WhitepaperPipelineLead[]
  summary: WhitepaperPipelineSummary
}> {
  const [{ leads }, records] = await Promise.all([
    loadWhitepaperLeads(),
    loadRecords(),
  ])

  const pipelineLeads = leads.map(lead => {
    const leadId = buildWhitepaperLeadId(lead.email, lead.downloadedAt)
    return {
      ...lead,
      leadId,
      pipeline: records[leadId] ?? defaultPipeline(leadId),
    }
  })

  const stageCounts = Object.fromEntries(
    PIPELINE_STAGES.map(stage => [stage, 0]),
  ) as Record<PipelineStage, number>

  for (const lead of pipelineLeads) {
    stageCounts[lead.pipeline.stage] += 1
  }

  const pending = pipelineLeads.filter(lead => !PIPELINE_STAGE_META[lead.pipeline.stage].terminal).length
  const overdue = pipelineLeads.filter(lead => isOverdue(lead.pipeline)).length
  const dueToday = pipelineLeads.filter(lead => isDueToday(lead.pipeline)).length

  return {
    leads: pipelineLeads,
    summary: { total: pipelineLeads.length, pending, overdue, dueToday, stageCounts },
  }
}

export async function updateWhitepaperPipeline(
  leadId: string,
  update: Pick<WhitepaperPipelineRecord, 'stage' | 'owner' | 'lastFollowedUpAt' | 'nextActionAt' | 'notes'>,
): Promise<WhitepaperPipelineRecord> {
  const records = await loadRecords()
  const record: WhitepaperPipelineRecord = {
    leadId,
    stage: update.stage,
    owner: update.owner,
    lastFollowedUpAt: update.lastFollowedUpAt,
    nextActionAt: update.nextActionAt,
    notes: update.notes,
    updatedAt: new Date().toISOString(),
  }
  records[leadId] = record
  await saveRecords(records)
  return record
}

/** DL履歴削除後に、そのユーザーに紐づくパイプライン情報もS3から削除する。 */
export async function deleteWhitepaperPipeline(leadId: string): Promise<void> {
  const records = await loadRecords()
  if (!(leadId in records)) return
  delete records[leadId]
  await saveRecords(records)
}
