'use client'

import SectionTabs from '@/components/navigation/SectionTabs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Building2,
  CalendarDays,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRound,
  Users,
  X,
} from 'lucide-react'

interface WhitepaperLead {
  email: string
  downloadedAt: string
  company: string
  considerationStatus: string
  name: string
  pdfTitle: string
  pdfVersion: string
  phone: string
}

interface WhitepaperLeadSummary {
  total: number
  last30Days: number
  latestDownloadedAt: string | null
  statusCounts: Record<string, number>
  documentCounts: Record<string, number>
}

interface WhitepaperLeadsResponse {
  leads: WhitepaperLead[]
  summary: WhitepaperLeadSummary
  error?: string
}

const EMPTY_SUMMARY: WhitepaperLeadSummary = {
  total: 0,
  last30Days: 0,
  latestDownloadedAt: null,
  statusCounts: {},
  documentCounts: {},
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

function dateOnly(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function statusColor(status: string): { color: string; background: string } {
  if (status.includes('具体') || status.includes('相談')) {
    return { color: '#c02637', background: 'rgba(229,62,79,0.09)' }
  }
  if (status.includes('収集')) {
    return { color: '#92600a', background: 'rgba(245,158,11,0.12)' }
  }
  return { color: '#475569', background: 'rgba(100,116,139,0.10)' }
}

function csvCell(value: string): string {
  // Excelの数式インジェクションを防ぐ。
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

function safeEmailHref(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : null
}

function safePhoneHref(phone: string): string | null {
  if (!phone || !/^[0-9+\-() ]+$/.test(phone)) return null
  return `tel:${phone.replace(/[^0-9+]/g, '')}`
}

export default function WhitepaperPage() {
  const [data, setData] = useState<WhitepaperLeadsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [document, setDocument] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState<WhitepaperLead | null>(null)

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/whitepaper-leads', { cache: 'no-store' })
      const json = (await response.json()) as WhitepaperLeadsResponse
      if (!response.ok) throw new Error(json.error || 'データの取得に失敗しました')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchLeads()
  }, [fetchLeads])

  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected])

  const leads = useMemo(() => data?.leads ?? [], [data])
  const summary = data?.summary ?? EMPTY_SUMMARY
  const statuses = useMemo(
    () => [...new Set(leads.map(lead => lead.considerationStatus).filter(Boolean))].sort(),
    [leads],
  )
  const documents = useMemo(
    () => [...new Set(leads.map(lead => lead.pdfTitle).filter(Boolean))].sort(),
    [leads],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja')
    return leads.filter(lead => {
      if (needle) {
        const haystack = [
          lead.name,
          lead.company,
          lead.email,
          lead.phone,
          lead.pdfTitle,
          lead.pdfVersion,
        ].join('\n').toLocaleLowerCase('ja')
        if (!haystack.includes(needle)) return false
      }
      if (status && lead.considerationStatus !== status) return false
      if (document && lead.pdfTitle !== document) return false
      const downloadedDate = dateOnly(lead.downloadedAt)
      if (dateFrom && downloadedDate < dateFrom) return false
      if (dateTo && downloadedDate > dateTo) return false
      return true
    })
  }, [leads, query, status, document, dateFrom, dateTo])

  const hasFilters = Boolean(query || status || document || dateFrom || dateTo)

  const clearFilters = () => {
    setQuery('')
    setStatus('')
    setDocument('')
    setDateFrom('')
    setDateTo('')
  }

  const downloadCsv = () => {
    const headers = [
      'ダウンロード日時',
      '氏名',
      '会社名',
      'メールアドレス',
      '電話番号',
      '検討状況',
      '資料名',
      '資料バージョン',
    ]
    const rows = filtered.map(lead => [
      lead.downloadedAt,
      lead.name,
      lead.company,
      lead.email,
      lead.phone,
      lead.considerationStatus,
      lead.pdfTitle,
      lead.pdfVersion,
    ])
    const csv = `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `whitepaper-leads-${dateOnly(new Date().toISOString())}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const topStatus = Object.entries(summary.statusCounts)
    .sort((a, b) => b[1] - a[1])[0]

  return (
    <div className="w-full py-8 max-w-[1200px] mx-auto">
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
            ホワイトペーパー
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            ホワイトペーパーをダウンロードしたユーザーと検討状況を管理します。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadCsv}
            disabled={loading || filtered.length === 0}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[9px] px-3.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              color: '#1267f2',
              background: 'var(--surface-raised)',
              border: '1px solid rgba(18,103,242,0.22)',
            }}
          >
            <Download size={14} />
            CSV出力
          </button>
          <button
            type="button"
            onClick={() => void fetchLeads()}
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
      </div>

      {error && (
        <div
          className="mb-5 flex items-start gap-2 rounded-[12px] px-4 py-3 text-sm"
          style={{
            color: '#c02637',
            background: 'rgba(229,62,79,0.07)',
            border: '1px solid rgba(229,62,79,0.24)',
          }}
        >
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '総ダウンロード', value: loading ? '—' : summary.total.toLocaleString(), suffix: '件', icon: Users },
          { label: '直近30日', value: loading ? '—' : summary.last30Days.toLocaleString(), suffix: '件', icon: CalendarDays },
          { label: '最新ダウンロード', value: loading ? '—' : formatDateTime(summary.latestDownloadedAt ?? ''), suffix: '', icon: Download },
          { label: '最多の検討状況', value: loading ? '—' : topStatus?.[0] ?? '未集計', suffix: topStatus ? `${topStatus[1]}件` : '', icon: SlidersHorizontal },
        ].map(card => {
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className="rounded-[14px] p-4"
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div className="flex items-center gap-2 text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                <Icon size={14} style={{ color: '#1267f2' }} />
                {card.label}
              </div>
              <div className="mt-2 min-h-[32px]">
                <span
                  className={card.label === '最新ダウンロード' || card.label === '最多の検討状況' ? 'text-sm font-bold' : 'text-2xl font-black'}
                  style={{ color: 'var(--ink)' }}
                >
                  {card.value}
                </span>
                {card.suffix && (
                  <span className="ml-1 text-[11px] font-semibold" style={{ color: 'var(--text-faint)' }}>
                    {card.suffix}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div
        className="mb-4 rounded-[14px] p-4"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1.5fr)_1fr_1fr_auto_auto]">
          <label className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-faint)' }}
            />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="氏名・会社・メール・電話・資料名で検索"
              className="h-10 w-full rounded-[9px] pl-9 pr-3 text-xs outline-none transition-shadow focus:ring-2 focus:ring-blue-200"
              style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
            />
          </label>
          <select
            value={status}
            onChange={event => setStatus(event.target.value)}
            className="h-10 rounded-[9px] px-3 text-xs outline-none"
            style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
          >
            <option value="">すべての検討状況</option>
            {statuses.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select
            value={document}
            onChange={event => setDocument(event.target.value)}
            className="h-10 rounded-[9px] px-3 text-xs outline-none"
            style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
          >
            <option value="">すべての資料</option>
            {documents.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <input
            type="date"
            aria-label="ダウンロード開始日"
            value={dateFrom}
            onChange={event => setDateFrom(event.target.value)}
            className="h-10 rounded-[9px] px-2 text-xs outline-none"
            style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
          />
          <input
            type="date"
            aria-label="ダウンロード終了日"
            value={dateTo}
            onChange={event => setDateTo(event.target.value)}
            className="h-10 rounded-[9px] px-2 text-xs outline-none"
            style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {loading ? '読み込み中' : `${filtered.length}件を表示（全${summary.total}件）`}
          </p>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] font-bold hover:underline"
              style={{ color: '#1267f2' }}
            >
              絞り込みを解除
            </button>
          )}
        </div>
      </div>

      <div
        className="overflow-hidden rounded-[14px]"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={19} className="animate-spin" style={{ color: '#1267f2' }} />
            DynamoDBから読み込んでいます...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center">
            <FileText size={28} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>該当するダウンロードがありません</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>検索条件を変更してお試しください。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="text-[11px]" style={{ color: 'var(--text-muted)', background: 'rgba(18,103,242,0.035)' }}>
                  {['DL日時', 'ユーザー', '会社名', '連絡先', '検討状況', '資料'].map(label => (
                    <th
                      key={label}
                      className="px-4 py-3 font-bold"
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(lead => {
                  const badge = statusColor(lead.considerationStatus)
                  return (
                    <tr
                      key={`${lead.email}-${lead.downloadedAt}`}
                      onClick={() => setSelected(lead)}
                      className="cursor-pointer transition-colors hover:bg-blue-50/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                        {formatDateTime(lead.downloadedAt)}
                      </td>
                      <td className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                        <p className="text-xs font-bold" style={{ color: 'var(--ink)' }}>{lead.name || '—'}</p>
                      </td>
                      <td className="max-w-[190px] px-4 py-3 text-xs" style={{ borderBottom: '1px solid var(--border)', color: 'var(--ink)' }}>
                        <span className="line-clamp-2">{lead.company || '—'}</span>
                      </td>
                      <td className="max-w-[220px] px-4 py-3 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
                        <p className="truncate" style={{ color: '#1267f2' }}>{lead.email}</p>
                        <p className="mt-0.5" style={{ color: 'var(--text-faint)' }}>{lead.phone || '—'}</p>
                      </td>
                      <td className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                        <span
                          className="inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold"
                          style={badge}
                        >
                          {lead.considerationStatus || '未回答'}
                        </span>
                      </td>
                      <td className="max-w-[240px] px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                        <p className="line-clamp-2 text-xs font-semibold" style={{ color: 'var(--ink)' }}>{lead.pdfTitle || '—'}</p>
                        {lead.pdfVersion && <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>{lead.pdfVersion}</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-right text-[10px]" style={{ color: 'var(--text-faint)' }}>
        読み取り専用・DynamoDB: nts-whitepaper-leads
      </p>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,20,50,0.45)', backdropFilter: 'blur(4px)' }}
          onMouseDown={event => {
            if (event.currentTarget === event.target) setSelected(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ダウンロードユーザー詳細"
            className="w-full max-w-lg rounded-[18px] p-6"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold" style={{ color: '#1267f2' }}>ダウンロードユーザー詳細</p>
                <h2 className="mt-1 text-lg font-bold" style={{ color: 'var(--ink)' }}>{selected.name || '氏名未設定'}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
                aria-label="閉じる"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={17} />
              </button>
            </div>

            <dl className="space-y-1">
              {[
                { label: 'DL日時', value: formatDateTime(selected.downloadedAt), icon: CalendarDays },
                { label: '氏名', value: selected.name || '—', icon: UserRound },
                { label: '会社名', value: selected.company || '—', icon: Building2 },
                { label: 'メール', value: selected.email, icon: Mail, href: safeEmailHref(selected.email) },
                { label: '電話番号', value: selected.phone || '—', icon: Phone, href: safePhoneHref(selected.phone) },
                { label: '検討状況', value: selected.considerationStatus || '未回答', icon: SlidersHorizontal },
                { label: '資料名', value: selected.pdfTitle || '—', icon: FileText },
                { label: 'バージョン', value: selected.pdfVersion || '—', icon: FileDown },
              ].map(row => {
                const Icon = row.icon
                return (
                  <div
                    key={row.label}
                    className="grid grid-cols-[110px_1fr] gap-3 rounded-[9px] px-3 py-2.5"
                    style={{ background: 'rgba(18,103,242,0.035)' }}
                  >
                    <dt className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                      <Icon size={13} />
                      {row.label}
                    </dt>
                    <dd className="break-words text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                      {row.href ? (
                        <a
                          href={row.href}
                          className="inline-flex items-center gap-1 hover:underline"
                          style={{ color: '#1267f2' }}
                        >
                          {row.value}
                          <ExternalLink size={11} />
                        </a>
                      ) : row.value}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
