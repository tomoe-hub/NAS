'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  FileDown,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import SectionTabs from '@/components/navigation/SectionTabs'

type PipelineStage = 'new' | 'contacted' | 'meeting' | 'nurturing' | 'won' | 'lost'

interface WhitepaperPipelineRecord {
  leadId: string
  stage: PipelineStage
  owner: string
  lastFollowedUpAt: string
  nextActionAt: string
  notes: string
  updatedAt: string
}

interface WhitepaperPipelineLead {
  leadId: string
  email: string
  downloadedAt: string
  company: string
  considerationStatus: string
  name: string
  pdfTitle: string
  pdfVersion: string
  phone: string
  pipeline: WhitepaperPipelineRecord
}

interface PipelineResponse {
  leads: WhitepaperPipelineLead[]
  summary: {
    total: number
    pending: number
    overdue: number
    dueToday: number
    stageCounts: Record<PipelineStage, number>
  }
  error?: string
}

const STAGES: Array<{ key: PipelineStage; label: string; color: string; background: string; terminal: boolean }> = [
  { key: 'new', label: '新規', color: '#1267f2', background: 'rgba(18,103,242,0.08)', terminal: false },
  { key: 'contacted', label: '接触済み', color: '#7c3aed', background: 'rgba(124,58,237,0.08)', terminal: false },
  { key: 'meeting', label: 'ヒアリング・商談', color: '#0f9f6e', background: 'rgba(15,159,110,0.09)', terminal: false },
  { key: 'nurturing', label: '提案・追客', color: '#c77916', background: 'rgba(199,121,22,0.10)', terminal: false },
  { key: 'won', label: '受注', color: '#047857', background: 'rgba(4,120,87,0.10)', terminal: true },
  { key: 'lost', label: '失注・対象外', color: '#64748b', background: 'rgba(100,116,139,0.10)', terminal: true },
]

const EMPTY: PipelineResponse = {
  leads: [],
  summary: {
    total: 0,
    pending: 0,
    overdue: 0,
    dueToday: 0,
    stageCounts: { new: 0, contacted: 0, meeting: 0, nurturing: 0, won: 0, lost: 0 },
  },
}

function stageMeta(stage: PipelineStage) {
  return STAGES.find(item => item.key === stage) ?? STAGES[0]!
}

function formatDate(value: string): string {
  if (!value) return '未設定'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  }).format(date)
}

function formatDateTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function isOverdue(lead: WhitepaperPipelineLead): boolean {
  if (stageMeta(lead.pipeline.stage).terminal || !lead.pipeline.nextActionAt) return false
  return lead.pipeline.nextActionAt < new Date().toISOString().slice(0, 10)
}

function isDueToday(lead: WhitepaperPipelineLead): boolean {
  if (stageMeta(lead.pipeline.stage).terminal || !lead.pipeline.nextActionAt) return false
  return lead.pipeline.nextActionAt === new Date().toISOString().slice(0, 10)
}

export default function WhitepaperPipelinePage() {
  const [data, setData] = useState<PipelineResponse>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<WhitepaperPipelineLead | null>(null)
  const [draft, setDraft] = useState<WhitepaperPipelineRecord | null>(null)

  const fetchPipeline = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/whitepaper-pipeline', { cache: 'no-store' })
      const json = (await response.json()) as PipelineResponse
      if (!response.ok) throw new Error(json.error || 'パイプラインを取得できませんでした')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'パイプラインを取得できませんでした')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPipeline()
  }, [fetchPipeline])

  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(null)
        setDraft(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

  const openEditor = (lead: WhitepaperPipelineLead) => {
    setSelected(lead)
    setDraft({ ...lead.pipeline })
  }

  const filteredLeads = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja')
    if (!needle) return data.leads
    return data.leads.filter(lead =>
      [lead.name, lead.company, lead.email, lead.pdfTitle, lead.pipeline.owner]
        .join('\n')
        .toLocaleLowerCase('ja')
        .includes(needle)
    )
  }, [data.leads, query])

  const save = async () => {
    if (!draft || !selected) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/whitepaper-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await response.json() as { error?: string }
      if (!response.ok) throw new Error(json.error || '保存に失敗しました')
      setSelected(null)
      setDraft(null)
      await fetchPipeline()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full py-8 max-w-[1440px] mx-auto">
      <SectionTabs
        label="ホワイトペーパー管理"
        tabs={[
          { href: '/whitepaper', label: 'DLユーザー一覧' },
          { href: '/whitepaper/pipeline', label: 'フォローアップ パイプライン' },
        ]}
      />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>
            <FileDown size={21} />
            フォローアップ パイプライン
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            ダウンロードユーザーのフォロー状況、次回アクション、商談化までの進捗を管理します。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchPipeline()}
          disabled={loading}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[9px] px-3.5 text-xs font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
            boxShadow: '0 4px 12px rgba(18,103,242,0.24)',
          }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          更新
        </button>
      </div>

      {error && (
        <div
          className="mb-5 flex items-start gap-2 rounded-[12px] px-4 py-3 text-sm"
          style={{ color: '#c02637', background: 'rgba(229,62,79,0.07)', border: '1px solid rgba(229,62,79,0.24)' }}
        >
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: '管理対象', value: data.summary.total, icon: Users, color: '#1267f2' },
          { label: 'フォロー中', value: data.summary.pending, icon: CircleDot, color: '#7c3aed' },
          { label: '本日アクション', value: data.summary.dueToday, icon: CalendarClock, color: '#c77916' },
          { label: '期限超過', value: data.summary.overdue, icon: Clock3, color: '#c02637' },
        ].map(card => {
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className="rounded-[14px] p-4"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                <Icon size={14} style={{ color: card.color }} />
                {card.label}
              </p>
              <p className="mt-1 text-2xl font-black" style={{ color: 'var(--ink)' }}>
                {loading ? '—' : card.value}
                <span className="ml-1 text-xs font-semibold" style={{ color: 'var(--text-faint)' }}>件</span>
              </p>
            </div>
          )
        })}
      </div>

      <div
        className="mb-4 flex items-center gap-2 rounded-[12px] px-3"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        <Search size={15} style={{ color: 'var(--text-faint)' }} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="氏名・会社・メール・資料名・担当者で絞り込み"
          className="h-10 w-full bg-transparent text-xs outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </div>

      {loading ? (
        <div
          className="flex min-h-[360px] items-center justify-center gap-2 rounded-[14px] text-sm"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <Loader2 size={19} className="animate-spin" style={{ color: '#1267f2' }} />
          パイプラインを読み込んでいます...
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex min-w-max gap-3">
            {STAGES.map(stage => {
              const leads = filteredLeads.filter(lead => lead.pipeline.stage === stage.key)
              return (
                <section
                  key={stage.key}
                  className="w-[270px] shrink-0 rounded-[14px] p-2.5"
                  style={{ background: stage.background, border: `1px solid ${stage.color}24` }}
                >
                  <div className="mb-2.5 flex items-center justify-between px-1">
                    <h2 className="text-xs font-bold" style={{ color: stage.color }}>{stage.label}</h2>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ color: stage.color, background: 'rgba(255,255,255,0.72)' }}
                    >
                      {leads.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {leads.length === 0 ? (
                      <p className="px-2 py-5 text-center text-[11px]" style={{ color: 'var(--text-faint)' }}>該当ユーザーなし</p>
                    ) : leads.map(lead => {
                      const overdue = isOverdue(lead)
                      const dueToday = isDueToday(lead)
                      return (
                        <button
                          type="button"
                          key={lead.leadId}
                          onClick={() => openEditor(lead)}
                          className="w-full rounded-[11px] p-3 text-left transition-all hover:-translate-y-px hover:shadow-md"
                          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: '0 1px 3px rgba(20,44,92,0.06)' }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-1 text-xs font-bold" style={{ color: 'var(--ink)' }}>{lead.name || lead.email}</p>
                            <ChevronRight size={14} className="shrink-0" style={{ color: 'var(--text-faint)' }} />
                          </div>
                          <p className="mt-1 line-clamp-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>{lead.company || '会社名未設定'}</p>
                          <p className="mt-2 line-clamp-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>{lead.pdfTitle || '資料名未設定'}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {lead.pipeline.owner && (
                              <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                <UserRound size={11} />{lead.pipeline.owner}
                              </span>
                            )}
                            {lead.pipeline.nextActionAt && (
                              <span
                                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                                style={{
                                  color: overdue ? '#c02637' : dueToday ? '#92600a' : '#64788a',
                                  background: overdue ? 'rgba(229,62,79,0.10)' : dueToday ? 'rgba(245,158,11,0.12)' : 'rgba(100,116,139,0.09)',
                                }}
                              >
                                {overdue ? '期限超過 ' : dueToday ? '本日 ' : '次回 '}
                                {formatDate(lead.pipeline.nextActionAt)}
                              </span>
                            )}
                          </div>
                          {lead.pipeline.notes && (
                            <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                              {lead.pipeline.notes}
                            </p>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      {selected && draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,20,50,0.45)', backdropFilter: 'blur(4px)' }}
          onMouseDown={event => {
            if (event.currentTarget === event.target && !saving) {
              setSelected(null)
              setDraft(null)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="フォローアップ情報の編集"
            className="w-full max-w-xl rounded-[18px] p-6"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold" style={{ color: '#1267f2' }}>フォローアップ管理</p>
                <h2 className="mt-1 text-lg font-bold" style={{ color: 'var(--ink)' }}>{selected.name || selected.email}</h2>
                <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{selected.company || '会社名未設定'} / DL: {formatDateTime(selected.downloadedAt)}</p>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setSelected(null)
                  setDraft(null)
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-50"
                aria-label="閉じる"
              >
                <X size={17} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                ステージ
                <select
                  value={draft.stage}
                  onChange={event => setDraft({ ...draft, stage: event.target.value as PipelineStage })}
                  className="mt-1.5 h-10 w-full rounded-[9px] px-3 text-xs font-semibold outline-none"
                  style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                >
                  {STAGES.map(stage => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                </select>
              </label>
              <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                担当者
                <input
                  value={draft.owner}
                  onChange={event => setDraft({ ...draft, owner: event.target.value })}
                  placeholder="例: 田中"
                  className="mt-1.5 h-10 w-full rounded-[9px] px-3 text-xs outline-none"
                  style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                />
              </label>
              <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                最終フォロー日
                <input
                  type="date"
                  value={draft.lastFollowedUpAt}
                  onChange={event => setDraft({ ...draft, lastFollowedUpAt: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-[9px] px-3 text-xs outline-none"
                  style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                />
              </label>
              <label className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                次回アクション日
                <input
                  type="date"
                  value={draft.nextActionAt}
                  min={draft.stage === 'new' ? '' : undefined}
                  onChange={event => setDraft({ ...draft, nextActionAt: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-[9px] px-3 text-xs outline-none"
                  style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                />
              </label>
            </div>

            <label className="mt-4 block text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
              フォローアップメモ
              <textarea
                value={draft.notes}
                onChange={event => setDraft({ ...draft, notes: event.target.value })}
                rows={5}
                placeholder="例: 7/22にメール送付。来週、事業承継の課題をヒアリング予定。"
                className="mt-1.5 w-full resize-y rounded-[9px] p-3 text-xs leading-relaxed outline-none"
                style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
              />
            </label>

            <div className="mt-5 flex items-center justify-between gap-3">
              <a
                href={`mailto:${selected.email}`}
                className="inline-flex items-center gap-1.5 text-xs font-bold hover:underline"
                style={{ color: '#1267f2' }}
              >
                <Mail size={14} />
                メールを作成
              </a>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[9px] px-4 text-xs font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)', boxShadow: '0 4px 12px rgba(18,103,242,0.24)' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                保存する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
