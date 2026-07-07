'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  LineChart as LineChartIcon,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  Users,
  MousePointerClick,
  Eye,
  Gauge,
  AlertTriangle,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import Button from '@/components/ui/Button'
import type { SeoDashboardData } from '@/lib/seo/aggregate'

type TabKey = 'overview' | 'gsc' | 'ga4' | 'clarity'
type RangeKey = '7d' | '28d' | '90d'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概要' },
  { key: 'gsc', label: '検索（GSC）' },
  { key: 'ga4', label: 'トラフィック（GA4）' },
  { key: 'clarity', label: 'UX（Clarity）' },
]

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7日' },
  { key: '28d', label: '28日' },
  { key: '90d', label: '90日' },
]

const PIE_COLORS = ['#1267f2', '#18a9e6', '#7c5cff', '#f59e0b', '#10b981', '#e53e4f', '#64748B', '#0a3fae']

/* ── 表示ヘルパー ── */

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('ja-JP')
}

function fmtPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

function fmtPos(n: number): string {
  return n > 0 ? n.toFixed(1) : '—'
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '未同期'
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 変化率/差分バッジ。isDiff=true は pt/絶対差表示、invert=true は減少が改善（掲載順位など） */
function ChangeBadge({ value, isDiff = false, invert = false, suffix = '%' }: {
  value: number
  isDiff?: boolean
  invert?: boolean
  suffix?: string
}) {
  const rounded = Math.round(value * 10) / 10
  const isZero = Math.abs(rounded) < 0.05
  const improved = invert ? rounded < 0 : rounded > 0
  const color = isZero ? '#64748B' : improved ? '#0f9d58' : '#e53e4f'
  const bg = isZero ? 'rgba(100,116,139,0.10)' : improved ? 'rgba(15,157,88,0.10)' : 'rgba(229,62,79,0.10)'
  const Icon = isZero ? Minus : rounded > 0 ? TrendingUp : TrendingDown
  const text = isZero
    ? '±0'
    : `${rounded > 0 ? '+' : ''}${isDiff ? rounded.toFixed(1) : rounded.toFixed(1)}${isDiff ? suffix : '%'}`
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[11px] font-bold"
      style={{ color, background: bg }}
    >
      <Icon size={11} strokeWidth={2.5} />
      {text}
    </span>
  )
}

function KpiCard({ label, value, change, icon: Icon, isDiff, invert, suffix }: {
  label: string
  value: string
  change?: number
  icon: LucideIcon
  isDiff?: boolean
  invert?: boolean
  suffix?: string
}) {
  return (
    <div
      className="rounded-[14px] p-4"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center"
          style={{ background: 'rgba(18,103,242,0.10)', color: '#1267f2' }}
        >
          <Icon size={14} strokeWidth={2.2} />
        </span>
        <span className="text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-[22px] font-black leading-none" style={{ color: 'var(--ink)' }}>{value}</div>
        {change !== undefined && <ChangeBadge value={change} isDiff={isDiff} invert={invert} suffix={suffix} />}
      </div>
    </div>
  )
}

function SectionCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[16px] p-5"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
        {note && <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{note}</span>}
      </div>
      {children}
    </div>
  )
}

function DataTable<T>({ columns, rows, keyOf }: {
  columns: Array<{ label: string; align?: 'left' | 'right'; render: (row: T) => React.ReactNode }>
  rows: T[]
  keyOf: (row: T, i: number) => string
}) {
  if (rows.length === 0) {
    return <p className="text-sm py-6 text-center" style={{ color: 'var(--text-faint)' }}>データがありません</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {columns.map((c, i) => (
              <th
                key={i}
                className={`py-2 px-2 font-semibold whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                style={{ color: 'var(--text-muted)' }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={keyOf(r, i)} style={{ borderBottom: '1px solid rgba(20,44,92,0.06)' }}>
              {columns.map((c, j) => (
                <td
                  key={j}
                  className={`py-2 px-2 ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'}`}
                  style={{ color: 'var(--ink)' }}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function truncateUrl(u: string, max = 56): string {
  const s = u.replace(/^https?:\/\/[^/]+/, '') || u
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** GSC のデバイス名（DESKTOP 等）を表示用に整形 */
function deviceLabel(device: string): string {
  const d = device.toLowerCase()
  return d.charAt(0).toUpperCase() + d.slice(1)
}

/* ── ページ本体 ── */

export default function SeoPage() {
  const [data, setData] = useState<SeoDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('28d')
  const [tab, setTab] = useState<TabKey>('overview')

  const load = useCallback(async (r: RangeKey) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/seo/metrics?range=${r}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `取得に失敗しました (${res.status})`)
      }
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(range)
  }, [range, load])

  const handleSync = async () => {
    setSyncing(true)
    setSyncMessage(null)
    setError(null)
    try {
      // 初回（データなし）は90日遡り、以降は28日で十分
      const days = data?.hasData ? 28 : 90
      const res = await fetch('/api/seo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `同期に失敗しました (${res.status})`)
      const parts: string[] = []
      for (const [label, src] of [['GA4', body.ga4], ['GSC', body.gsc], ['Clarity', body.clarity]] as const) {
        if (!src) continue
        if (src.status === 'ok') parts.push(`${label}: ${src.count}件`)
        else if (src.status === 'skipped_missing_config') parts.push(`${label}: 未設定`)
        else parts.push(`${label}: 失敗`)
      }
      setSyncMessage(`同期完了 — ${parts.join(' / ')}`)
      await load(range)
    } catch (e) {
      setError(e instanceof Error ? e.message : '同期に失敗しました')
    } finally {
      setSyncing(false)
    }
  }

  const kpi = data?.kpi

  return (
    <div className="w-full py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <LineChartIcon size={20} />
            SEO分析
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            GA4・Search Console・Microsoft Clarity のデータを集約したダッシュボード。毎日自動同期されます。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>最終同期</div>
            <div className="text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>
              {fmtDateTime(data?.meta?.lastSyncAt ?? data?.meta?.lastGscSyncAt)}
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {syncing ? '同期中...' : 'データ同期'}
          </Button>
        </div>
      </div>

      {syncMessage && (
        <div
          className="rounded-[12px] px-4 py-2.5 mb-4 text-sm font-medium"
          style={{ background: 'rgba(15,157,88,0.08)', border: '1px solid rgba(15,157,88,0.25)', color: '#0f7d46' }}
        >
          {syncMessage}
        </div>
      )}
      {error && (
        <div
          className="rounded-[12px] px-4 py-2.5 mb-4 text-sm font-medium flex items-center gap-2"
          style={{ background: 'rgba(229,62,79,0.07)', border: '1px solid rgba(229,62,79,0.25)', color: '#c02637' }}
        >
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* 前回同期で失敗・未設定のソースがあれば原因を表示 */}
      {data?.meta?.lastResult && (() => {
        const r = data.meta.lastResult!
        const issues = ([
          ['GA4', r.ga4],
          ['Search Console', r.gsc],
          ['Clarity', r.clarity],
        ] as const).filter(([, s]) => s && s.status !== 'ok')
        if (issues.length === 0) return null
        return (
          <div
            className="rounded-[12px] px-4 py-3 mb-4 text-[13px] space-y-1.5"
            style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.30)', color: '#92600a' }}
          >
            <div className="font-bold flex items-center gap-1.5">
              <AlertTriangle size={14} />
              前回の同期（{fmtDateTime(r.syncedAt)}）で取得できなかったデータソースがあります
            </div>
            {issues.map(([label, s]) => (
              <div key={label} className="pl-5">
                <span className="font-semibold">{label}</span>
                {s.status === 'skipped_missing_config' ? '（環境変数が未設定）' : '（取得失敗）'}
                {s.error && <span className="break-all">: {s.error.slice(0, 300)}</span>}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Tabs + Range */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 border-b border-[#E2E8F0]">
        <div className="flex gap-5">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap ${
                tab === t.key
                  ? 'text-[#002C93] border-[#002C93]'
                  : 'text-[#64748B] border-transparent hover:text-[#1A1A2E]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 pb-2">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="px-3 py-1 rounded-[8px] text-[12px] font-semibold transition-colors"
              style={
                range === r.key
                  ? { background: '#002C93', color: '#fff' }
                  : { background: 'rgba(20,44,92,0.06)', color: 'var(--text-muted)' }
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div
          className="rounded-[16px] p-16 flex items-center justify-center gap-3"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}
        >
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--primary)' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>読み込み中...</span>
        </div>
      ) : !data ? null : !data.hasData ? (
        <div
          className="rounded-[16px] p-14 text-center"
          style={{ background: 'var(--surface-raised)', border: '1.5px dashed var(--border)' }}
        >
          <p className="font-bold mb-2" style={{ color: 'var(--ink)' }}>まだSEOデータがありません</p>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            右上の「データ同期」ボタンを押すと、GA4・Search Console・Clarity から過去90日分のデータを取得してS3に保存します。
            <br />
            環境変数（GOOGLE_SERVICE_ACCOUNT_JSON / GA4_PROPERTY_ID / GSC_PROPERTY_URL / CLARITY_API_TOKEN）の設定が必要です。
          </p>
          <Button variant="primary" onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {syncing ? '同期中...' : '初回データ同期を実行'}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── 概要 ── */}
          {tab === 'overview' && kpi && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="セッション" value={fmtInt(kpi.current.sessions)} change={kpi.change.sessions} icon={Users} />
                <KpiCard label="ユーザー" value={fmtInt(kpi.current.users)} change={kpi.change.users} icon={Users} />
                <KpiCard label="表示回数" value={fmtInt(kpi.current.impressions)} change={kpi.change.impressions} icon={Eye} />
                <KpiCard label="クリック" value={fmtInt(kpi.current.clicks)} change={kpi.change.clicks} icon={MousePointerClick} />
                <KpiCard label="CTR" value={fmtPct(kpi.current.ctr, 2)} change={kpi.change.ctr} icon={Gauge} isDiff suffix="pt" />
                <KpiCard label="平均掲載順位" value={fmtPos(kpi.current.avgPosition)} change={kpi.change.avgPosition} icon={Search} isDiff invert suffix="" />
              </div>

              <SectionCard title="推移（セッション / クリック / 表示回数）" note={`${data.window.start} 〜 ${data.window.end}`}>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.timeseries} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradSessions" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1267f2" stopOpacity={0.32} />
                          <stop offset="100%" stopColor="#1267f2" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradClicks" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#18a9e6" stopOpacity={0.30} />
                          <stop offset="100%" stopColor="#18a9e6" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradImpressions" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.18} />
                          <stop offset="100%" stopColor="#7c5cff" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(20,44,92,0.08)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748B' }} width={44} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748B' }} width={52} />
                      <Tooltip
                        contentStyle={{ borderRadius: 10, border: '1px solid rgba(20,44,92,0.14)', fontSize: 12 }}
                        labelStyle={{ fontWeight: 700 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area yAxisId="right" type="monotone" dataKey="impressions" name="表示回数" stroke="#7c5cff" strokeWidth={1.5} fill="url(#gradImpressions)" />
                      <Area yAxisId="left" type="monotone" dataKey="sessions" name="セッション" stroke="#1267f2" strokeWidth={2} fill="url(#gradSessions)" />
                      <Area yAxisId="left" type="monotone" dataKey="clicks" name="クリック" stroke="#18a9e6" strokeWidth={2} fill="url(#gradClicks)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SectionCard title="チャネル構成（セッション）">
                  {data.channelMix.length === 0 ? (
                    <p className="text-sm py-6 text-center" style={{ color: 'var(--text-faint)' }}>データがありません</p>
                  ) : (
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data.channelMix}
                            dataKey="sessions"
                            nameKey="name"
                            innerRadius={58}
                            outerRadius={92}
                            paddingAngle={2}
                          >
                            {data.channelMix.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: 10, border: '1px solid rgba(20,44,92,0.14)', fontSize: 12 }}
                            formatter={(v, name) => [`${fmtInt(Number(v ?? 0))} sessions`, String(name)]}
                          />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="上位クエリ Top10">
                  <DataTable
                    columns={[
                      { label: 'クエリ', render: (r: SeoDashboardData['topQueries'][number]) => <span className="font-medium">{r.query}</span> },
                      { label: 'クリック', align: 'right', render: r => fmtInt(r.clicks) },
                      { label: '表示', align: 'right', render: r => fmtInt(r.impressions) },
                      { label: 'CTR', align: 'right', render: r => fmtPct(r.ctr) },
                      { label: '順位', align: 'right', render: r => fmtPos(r.position) },
                    ]}
                    rows={data.topQueries.slice(0, 10)}
                    keyOf={r => r.query}
                  />
                </SectionCard>
              </div>

              <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{data.freshnessNote}</p>
            </>
          )}

          {/* ── 検索（GSC） ── */}
          {tab === 'gsc' && kpi && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard label="クリック" value={fmtInt(kpi.current.clicks)} change={kpi.change.clicks} icon={MousePointerClick} />
                <KpiCard label="表示回数" value={fmtInt(kpi.current.impressions)} change={kpi.change.impressions} icon={Eye} />
                <KpiCard label="CTR" value={fmtPct(kpi.current.ctr, 2)} change={kpi.change.ctr} icon={Gauge} isDiff suffix="pt" />
                <KpiCard label="平均掲載順位" value={fmtPos(kpi.current.avgPosition)} change={kpi.change.avgPosition} icon={Search} isDiff invert suffix="" />
              </div>

              <SectionCard title="クリック・表示回数の推移" note={`${data.window.start} 〜 ${data.window.end}`}>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.timeseries} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradClicks2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1267f2" stopOpacity={0.32} />
                          <stop offset="100%" stopColor="#1267f2" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradImp2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.18} />
                          <stop offset="100%" stopColor="#7c5cff" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(20,44,92,0.08)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748B' }} width={44} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748B' }} width={52} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid rgba(20,44,92,0.14)', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area yAxisId="right" type="monotone" dataKey="impressions" name="表示回数" stroke="#7c5cff" strokeWidth={1.5} fill="url(#gradImp2)" />
                      <Area yAxisId="left" type="monotone" dataKey="clicks" name="クリック" stroke="#1267f2" strokeWidth={2} fill="url(#gradClicks2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <SectionCard title="上位クエリ Top20">
                <DataTable
                  columns={[
                    { label: 'クエリ', render: (r: SeoDashboardData['topQueries'][number]) => <span className="font-medium">{r.query}</span> },
                    { label: 'クリック', align: 'right', render: r => fmtInt(r.clicks) },
                    { label: '表示', align: 'right', render: r => fmtInt(r.impressions) },
                    { label: 'CTR', align: 'right', render: r => fmtPct(r.ctr) },
                    { label: '順位', align: 'right', render: r => fmtPos(r.position) },
                  ]}
                  rows={data.topQueries}
                  keyOf={r => r.query}
                />
              </SectionCard>

              <SectionCard title="上位ページ Top20">
                <DataTable
                  columns={[
                    { label: 'ページ', render: (r: SeoDashboardData['topPagesGsc'][number]) => <span className="font-medium" title={r.page}>{truncateUrl(r.page)}</span> },
                    { label: 'クリック', align: 'right', render: r => fmtInt(r.clicks) },
                    { label: '表示', align: 'right', render: r => fmtInt(r.impressions) },
                    { label: 'CTR', align: 'right', render: r => fmtPct(r.ctr) },
                    { label: '順位', align: 'right', render: r => fmtPos(r.position) },
                  ]}
                  rows={data.topPagesGsc}
                  keyOf={r => r.page}
                />
              </SectionCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SectionCard title="デバイス別（クリック構成）">
                  {data.gscDevices.length === 0 ? (
                    <p className="text-sm py-6 text-center" style={{ color: 'var(--text-faint)' }}>データがありません</p>
                  ) : (
                    <>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={data.gscDevices.map(d => ({ ...d, label: deviceLabel(d.device) }))}
                              dataKey="clicks"
                              nameKey="label"
                              innerRadius={52}
                              outerRadius={86}
                              paddingAngle={3}
                            >
                              {data.gscDevices.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{ borderRadius: 10, border: '1px solid rgba(20,44,92,0.14)', fontSize: 12 }}
                              formatter={(v, name) => [`${fmtInt(Number(v ?? 0))} クリック`, String(name)]}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {data.gscDevices.map((r, i) => (
                          <div key={r.device} className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                            />
                            <span className="font-semibold w-[64px]" style={{ color: 'var(--ink)' }}>{deviceLabel(r.device)}</span>
                            <span className="tabular-nums">{fmtInt(r.clicks)} クリック / {fmtInt(r.impressions)} 表示 / CTR {fmtPct(r.ctr)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </SectionCard>
                <SectionCard title="国別 Top10">
                  <DataTable
                    columns={[
                      { label: '国', render: (r: SeoDashboardData['gscCountries'][number]) => <span className="font-medium uppercase">{r.country}</span> },
                      { label: 'クリック', align: 'right', render: r => fmtInt(r.clicks) },
                      { label: '表示', align: 'right', render: r => fmtInt(r.impressions) },
                      { label: 'CTR', align: 'right', render: r => fmtPct(r.ctr) },
                    ]}
                    rows={data.gscCountries}
                    keyOf={r => r.country}
                  />
                </SectionCard>
              </div>
            </>
          )}

          {/* ── トラフィック（GA4） ── */}
          {tab === 'ga4' && kpi && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard label="セッション" value={fmtInt(kpi.current.sessions)} change={kpi.change.sessions} icon={Users} />
                <KpiCard label="ユーザー" value={fmtInt(kpi.current.users)} change={kpi.change.users} icon={Users} />
                <KpiCard label="新規ユーザー" value={fmtInt(kpi.current.newUsers)} change={kpi.change.newUsers} icon={Users} />
                <KpiCard label="ページビュー" value={fmtInt(kpi.current.pageViews)} change={kpi.change.pageViews} icon={Eye} />
                <KpiCard label="エンゲージ率" value={fmtPct(kpi.current.engagementRate)} change={kpi.change.engagementRate} icon={Gauge} isDiff suffix="pt" />
                <KpiCard label="コンバージョン" value={fmtInt(kpi.current.conversions)} change={kpi.change.conversions} icon={TrendingUp} />
              </div>

              <SectionCard title="セッション・ユーザーの推移" note={`${data.window.start} 〜 ${data.window.end}`}>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.timeseries} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradSess2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1267f2" stopOpacity={0.32} />
                          <stop offset="100%" stopColor="#1267f2" stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradUsers2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.22} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(20,44,92,0.08)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748B' }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} width={44} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid rgba(20,44,92,0.14)', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="sessions" name="セッション" stroke="#1267f2" strokeWidth={2} fill="url(#gradSess2)" />
                      <Area type="monotone" dataKey="users" name="ユーザー" stroke="#10b981" strokeWidth={2} fill="url(#gradUsers2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <SectionCard title="チャネル構成">
                  <DataTable
                    columns={[
                      { label: 'チャネル', render: (r: SeoDashboardData['channelMix'][number]) => <span className="font-medium">{r.name}</span> },
                      { label: 'セッション', align: 'right', render: r => fmtInt(r.sessions) },
                      { label: 'CV', align: 'right', render: r => fmtInt(r.conversions) },
                      { label: '構成比', align: 'right', render: r => `${r.share}%` },
                    ]}
                    rows={data.channelMix}
                    keyOf={r => r.name}
                  />
                </SectionCard>
                <SectionCard title="デバイス別（GA4）">
                  <DataTable
                    columns={[
                      { label: 'デバイス', render: (r: SeoDashboardData['ga4Devices'][number]) => <span className="font-medium capitalize">{r.deviceCategory}</span> },
                      { label: 'セッション', align: 'right', render: r => fmtInt(r.sessions) },
                      { label: 'ユーザー', align: 'right', render: r => fmtInt(r.users) },
                    ]}
                    rows={data.ga4Devices}
                    keyOf={r => r.deviceCategory}
                  />
                </SectionCard>
              </div>

              <SectionCard title="上位ページ Top20（セッション）">
                <DataTable
                  columns={[
                    { label: 'ページ', render: (r: SeoDashboardData['topPagesGa4'][number]) => <span className="font-medium" title={r.pagePath}>{truncateUrl(r.pagePath)}</span> },
                    { label: 'セッション', align: 'right', render: r => fmtInt(r.sessions) },
                    { label: 'PV', align: 'right', render: r => fmtInt(r.pageViews) },
                    { label: 'エンゲージ率', align: 'right', render: r => fmtPct(r.engagementRate) },
                  ]}
                  rows={data.topPagesGa4}
                  keyOf={r => r.pagePath}
                />
              </SectionCard>
            </>
          )}

          {/* ── UX（Clarity） ── */}
          {tab === 'clarity' && (
            data.clarity ? (
              <>
                <p className="text-[12px] -mb-2" style={{ color: 'var(--text-faint)' }}>
                  Microsoft Clarity のライブ集計スナップショット（{data.clarity.ux.snapshotDate} 時点・直近{data.clarity.ux.windowDays}日間）
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* UXスコア */}
                  <div
                    className="rounded-[16px] p-6 flex flex-col items-center justify-center"
                    style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
                  >
                    <div className="text-[13px] font-semibold mb-3" style={{ color: 'var(--text-muted)' }}>UXスコア</div>
                    <div className="relative w-[140px] h-[140px]">
                      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                        <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(20,44,92,0.08)" strokeWidth="12" />
                        <circle
                          cx="60" cy="60" r="52" fill="none"
                          stroke={data.clarity.ux.score >= 70 ? '#0f9d58' : data.clarity.ux.score >= 40 ? '#f59e0b' : '#e53e4f'}
                          strokeWidth="12"
                          strokeLinecap="round"
                          strokeDasharray={`${(data.clarity.ux.score / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-[30px] font-black leading-none" style={{ color: 'var(--ink)' }}>{data.clarity.ux.score}</span>
                        <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>/ 100</span>
                      </div>
                    </div>
                    <p className="text-[11px] mt-3 text-center" style={{ color: 'var(--text-faint)' }}>
                      Dead/Rage クリック率とスクロール深度から算出
                    </p>
                  </div>

                  {/* UX指標 */}
                  <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3 content-start">
                    <KpiCard label="セッション" value={fmtInt(data.clarity.ux.sessions)} icon={Users} />
                    <KpiCard label="ユニークユーザー" value={fmtInt(data.clarity.ux.distinctUsers)} icon={Users} />
                    <KpiCard label="ページ/セッション" value={data.clarity.ux.pagesPerSession > 0 ? data.clarity.ux.pagesPerSession.toFixed(1) : '—'} icon={Eye} />
                    <KpiCard label="スクロール深度" value={`${data.clarity.ux.scrollDepth.toFixed(1)}%`} icon={Gauge} />
                    <KpiCard label="Deadクリック率" value={fmtPct(data.clarity.ux.deadClickRate)} icon={MousePointerClick} />
                    <KpiCard label="Rageクリック率" value={fmtPct(data.clarity.ux.rageClickRate)} icon={AlertTriangle} />
                    <KpiCard label="Quickback" value={fmtInt(data.clarity.ux.quickbackCount)} icon={TrendingDown} />
                    <KpiCard label="過剰スクロール" value={fmtInt(data.clarity.ux.excessiveScrollCount)} icon={Gauge} />
                    <KpiCard label="Bot比率" value={fmtPct(data.clarity.ux.botTrafficRate)} icon={AlertTriangle} />
                  </div>
                </div>

                <SectionCard title="人気ページ（Clarity）">
                  <DataTable
                    columns={[
                      { label: 'URL', render: (r: NonNullable<SeoDashboardData['clarity']>['topPages'][number]) => <span className="font-medium" title={r.url}>{truncateUrl(r.url)}</span> },
                      { label: '訪問', align: 'right', render: r => fmtInt(r.traffic) },
                      { label: 'スクロール深度', align: 'right', render: r => `${r.scrollDepth.toFixed(1)}%` },
                      { label: 'Dead', align: 'right', render: r => fmtInt(r.deadClickCount) },
                      { label: 'Rage', align: 'right', render: r => fmtInt(r.rageClickCount) },
                    ]}
                    rows={data.clarity.topPages}
                    keyOf={r => r.url}
                  />
                </SectionCard>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <SectionCard title="参照元 Top10">
                    <DataTable
                      columns={[
                        { label: '参照元', render: (r: NonNullable<SeoDashboardData['clarity']>['referrers'][number]) => <span className="font-medium">{truncateUrl(r.referrer, 40)}</span> },
                        { label: '訪問', align: 'right', render: r => fmtInt(r.traffic) },
                      ]}
                      rows={data.clarity.referrers}
                      keyOf={r => r.referrer}
                    />
                  </SectionCard>
                  <SectionCard title="ブラウザ別">
                    <DataTable
                      columns={[
                        { label: 'ブラウザ', render: (r: NonNullable<SeoDashboardData['clarity']>['browsers'][number]) => <span className="font-medium">{r.browser}</span> },
                        { label: '訪問', align: 'right', render: r => fmtInt(r.traffic) },
                      ]}
                      rows={data.clarity.browsers}
                      keyOf={r => r.browser}
                    />
                  </SectionCard>
                </div>
              </>
            ) : (
              <div
                className="rounded-[16px] p-14 text-center"
                style={{ background: 'var(--surface-raised)', border: '1.5px dashed var(--border)' }}
              >
                <p className="font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Clarityのデータがまだありません</p>
                <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
                  CLARITY_API_TOKEN を設定して「データ同期」を実行すると表示されます
                </p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
