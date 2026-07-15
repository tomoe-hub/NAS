'use client'

import SectionTabs from '@/components/navigation/SectionTabs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ScanSearch,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Target,
  Globe,
  Plus,
  RefreshCw,
  History,
  Filter,
} from 'lucide-react'
import type {
  SiteAuditDocument,
  SiteAuditSnapshot,
  SiteAuditOverall,
  PageAuditResult,
  AuditPriority,
  AuditPhase,
} from '@/lib/siteAudit'

interface AuditPageDef {
  url: string
  label: string
  phase?: AuditPhase
}

const PRIORITY_META: Record<AuditPriority, { label: string; color: string; bg: string }> = {
  high: { label: '優先度 高', color: '#c02637', bg: 'rgba(229,62,79,0.10)' },
  medium: { label: '優先度 中', color: '#92600a', bg: 'rgba(245,158,11,0.12)' },
  low: { label: '優先度 低', color: '#475569', bg: 'rgba(100,116,139,0.12)' },
}

/** ファネルフェーズの表示定義（上から下へ顧客が進む順） */
const PHASES: { key: AuditPhase; label: string; desc: string; color: string; gradient: string }[] = [
  { key: 'entrance', label: '入口・ブランド', desc: 'サイトの顔。第一印象と各ページへの導線', color: '#1267f2', gradient: 'linear-gradient(90deg, #1267f2 0%, #4f8ef7 100%)' },
  { key: 'awareness', label: '認知', desc: '検索・SNSからの流入を集める', color: '#0ea5e9', gradient: 'linear-gradient(90deg, #0ea5e9 0%, #38bdf8 100%)' },
  { key: 'research', label: '情報収集', desc: '課題を自覚した見込み客が学ぶ', color: '#14b8a6', gradient: 'linear-gradient(90deg, #14b8a6 0%, #2dd4bf 100%)' },
  { key: 'comparison', label: '比較検討', desc: '依頼先として信頼できるか見極める', color: '#f59e0b', gradient: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)' },
  { key: 'conversion', label: '意思決定・CV', desc: '問い合わせ・サービス利用に進む', color: '#e53e4f', gradient: 'linear-gradient(90deg, #e53e4f 0%, #f4708a 100%)' },
]

const OTHER_PHASE = { key: 'other' as AuditPhase, label: 'ファネル外', desc: '採用など、顧客導線とは別の役割のページ' }

function scoreColor(score: number): string {
  return score >= 80 ? '#0f9d58' : score >= 60 ? '#f59e0b' : '#e53e4f'
}

function scoreGrade(score: number): string {
  return score >= 80 ? '良好' : score >= 60 ? '要改善' : '要対策'
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtTabDate(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}`
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('ja-JP')
}

function pageAnchorId(url: string): string {
  return `audit-page-${encodeURIComponent(url)}`
}

/** スコアの円形ゲージ */
function ScoreRing({ score, size = 64, stroke = 7 }: { score: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = scoreColor(score)
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(20,44,92,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-black leading-none" style={{ color: 'var(--ink)', fontSize: size * 0.3 }}>
          {score}
        </span>
      </div>
    </div>
  )
}

/** 技術チェックのステータスチップ */
function TechChip({ status, label }: { status: 'ok' | 'warn' | 'ng'; label: string }) {
  const meta =
    status === 'ok'
      ? { color: '#0f7d46', bg: 'rgba(15,157,88,0.09)' }
      : status === 'warn'
        ? { color: '#92600a', bg: 'rgba(245,158,11,0.10)' }
        : { color: '#c02637', bg: 'rgba(229,62,79,0.09)' }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[7px] text-[11px] font-semibold"
      style={{ color: meta.color, background: meta.bg }}
    >
      {status === 'ok' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
      {label}
    </span>
  )
}

function buildTechChips(r: PageAuditResult): { status: 'ok' | 'warn' | 'ng'; label: string }[] {
  const t = r.tech
  const chips: { status: 'ok' | 'warn' | 'ng'; label: string }[] = []

  if (!t.title) chips.push({ status: 'ng', label: 'タイトル未設定' })
  else if (t.titleLength > 70 || t.titleLength < 10) chips.push({ status: 'warn', label: `タイトル ${t.titleLength}字` })
  else chips.push({ status: 'ok', label: `タイトル ${t.titleLength}字` })

  if (!t.metaDescription) chips.push({ status: 'ng', label: 'メタ説明 未設定' })
  else if (t.metaDescriptionLength > 160 || t.metaDescriptionLength < 30) chips.push({ status: 'warn', label: `メタ説明 ${t.metaDescriptionLength}字` })
  else chips.push({ status: 'ok', label: `メタ説明 ${t.metaDescriptionLength}字` })

  if (t.h1Texts.length === 1) chips.push({ status: 'ok', label: 'H1 1個' })
  else if (t.h1Texts.length === 0) chips.push({ status: 'ng', label: 'H1なし' })
  else chips.push({ status: 'warn', label: `H1 ${t.h1Texts.length}個` })

  if (t.imagesMissingAlt === 0) chips.push({ status: 'ok', label: 'alt OK' })
  else chips.push({ status: 'warn', label: `alt未設定 ${t.imagesMissingAlt}枚` })

  chips.push({ status: t.hasOgp ? 'ok' : 'warn', label: t.hasOgp ? 'OGPあり' : 'OGPなし' })
  chips.push({
    status: t.structuredDataTypes.length > 0 ? 'ok' : 'warn',
    label: t.structuredDataTypes.length > 0 ? `構造化データ ${t.structuredDataTypes.length}種` : '構造化データなし',
  })
  if (t.isNoindex) chips.push({ status: 'ng', label: 'noindex設定あり' })
  if (t.httpStatus !== 200) chips.push({ status: 'ng', label: `HTTP ${t.httpStatus}` })

  return chips
}

export default function SiteAuditPage() {
  const [doc, setDoc] = useState<SiteAuditDocument | null>(null)
  const [history, setHistory] = useState<SiteAuditSnapshot[]>([])
  const [defaultPages, setDefaultPages] = useState<AuditPageDef[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [customUrl, setCustomUrl] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customPages, setCustomPages] = useState<AuditPageDef[]>([])

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [runErrors, setRunErrors] = useState<string[]>([])

  /** 表示中の診断: 'latest' または履歴の日付（YYYY-MM-DD） */
  const [viewTab, setViewTab] = useState<string>('latest')

  const refresh = useCallback(async (opts?: { initSelection?: boolean }) => {
    const res = await fetch('/api/site-audit', { cache: 'no-store' })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? '取得に失敗しました')
    setDoc(body.doc)
    setHistory(body.history ?? [])
    setDefaultPages(body.defaultPages ?? [])
    if (opts?.initSelection) {
      setSelected(new Set((body.defaultPages ?? []).map((p: AuditPageDef) => p.url)))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await refresh({ initSelection: true })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '取得に失敗しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [refresh])

  /** プリセット＋過去に診断したページ＋手動追加の統合一覧 */
  const allPages: AuditPageDef[] = useMemo(() => {
    const seen = new Set<string>()
    const out: AuditPageDef[] = []
    for (const p of [...defaultPages, ...customPages]) {
      if (seen.has(p.url)) continue
      seen.add(p.url)
      out.push(p)
    }
    for (const p of Object.values(doc?.pages ?? {})) {
      if (seen.has(p.url)) continue
      seen.add(p.url)
      out.push({ url: p.url, label: p.label, phase: p.phase })
    }
    return out
  }, [defaultPages, customPages, doc])

  /** 表示対象（最新 or 履歴スナップショット） */
  const view: { pages: Record<string, PageAuditResult>; overall?: SiteAuditOverall; dateLabel: string; isHistory: boolean } = useMemo(() => {
    if (viewTab !== 'latest') {
      const snap = history.find(h => h.date === viewTab)
      if (snap) {
        return { pages: snap.pages, overall: snap.overall, dateLabel: `${fmtTabDate(snap.date)} 時点`, isHistory: true }
      }
    }
    return { pages: doc?.pages ?? {}, overall: doc?.overall, dateLabel: '最新', isHistory: false }
  }, [viewTab, history, doc])

  const viewedPages = useMemo(() => {
    const list = Object.values(view.pages)
    const order = new Map(allPages.map((p, i) => [p.url, i]))
    return list.sort((a, b) => (order.get(a.url) ?? 999) - (order.get(b.url) ?? 999))
  }, [view, allPages])

  const scored = useMemo(() => viewedPages.filter(p => p.ai), [viewedPages])
  const avgScore = useMemo(
    () => (scored.length > 0 ? Math.round(scored.reduce((s, p) => s + (p.ai?.score ?? 0), 0) / scored.length) : 0),
    [scored],
  )
  const gradeCounts = useMemo(() => {
    const c = { good: 0, warn: 0, bad: 0 }
    for (const p of scored) {
      const s = p.ai!.score
      if (s >= 80) c.good++
      else if (s >= 60) c.warn++
      else c.bad++
    }
    return c
  }, [scored])

  const toggle = (url: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const handleAddCustom = () => {
    const url = customUrl.trim()
    if (!url) return
    try {
      new URL(url)
    } catch {
      setError('URLの形式が正しくありません')
      return
    }
    setError(null)
    const def: AuditPageDef = { url, label: customLabel.trim() || url, phase: 'other' }
    setCustomPages(prev => (prev.some(p => p.url === url) ? prev : [...prev, def]))
    setSelected(prev => new Set(prev).add(url))
    setCustomUrl('')
    setCustomLabel('')
  }

  const handleRun = async () => {
    if (running) return
    const targets = allPages.filter(p => selected.has(p.url))
    if (targets.length === 0) return
    setRunning(true)
    setRunErrors([])
    setError(null)
    setViewTab('latest')

    const errors: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      setProgress({ done: i, total: targets.length, current: t.label })
      try {
        const res = await fetch('/api/site-audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'page', url: t.url, label: t.label }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? `診断に失敗しました (${res.status})`)
        setDoc(prev => {
          const next: SiteAuditDocument = prev
            ? { ...prev, pages: { ...prev.pages } }
            : { updatedAt: '', pages: {} }
          next.pages[t.url] = body.result
          next.updatedAt = body.result.generatedAt
          return next
        })
      } catch (e) {
        errors.push(`${t.label}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    setProgress({ done: targets.length, total: targets.length, current: '総合サマリを生成中' })
    try {
      const res = await fetch('/api/site-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'overall' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `総合サマリの生成に失敗しました (${res.status})`)
      setDoc(prev => (prev ? { ...prev, overall: body.overall } : prev))
    } catch (e) {
      errors.push(`総合サマリ: ${e instanceof Error ? e.message : String(e)}`)
    }

    // 履歴（日付タブ）を更新
    try {
      await refresh()
    } catch {
      /* 次回ロード時に反映される */
    }

    setRunErrors(errors)
    setProgress(null)
    setRunning(false)
  }

  const scrollToPage = (url: string) => {
    document.getElementById(pageAnchorId(url))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** ファネルの各フェーズに属するページ（診断結果があれば紐付け） */
  const phasePages = useMemo(() => {
    const map = new Map<AuditPhase, { def: AuditPageDef; result?: PageAuditResult }[]>()
    for (const p of allPages) {
      const result = view.pages[p.url]
      const phase: AuditPhase = result?.phase ?? p.phase ?? 'other'
      const arr = map.get(phase) ?? []
      arr.push({ def: p, result })
      map.set(phase, arr)
    }
    return map
  }, [allPages, view])

  const hasAnyResult = viewedPages.length > 0

  return (
    <div className="w-full py-8 max-w-5xl mx-auto">
      <SectionTabs
        label="SEO・戦略分析"
        tabs={[
          { href: '/seo', label: 'SEO分析' },
          { href: '/site-audit', label: '総合分析' },
          { href: '/competitive-analysis', label: '競合分析' },
          { href: '/personas', label: '仮説ペルソナ' },
        ]}
      />
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <ScanSearch size={20} />
          総合分析
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          日本提携支援の各ページを実際に取得して技術チェックし、GSC/GA4の実測値と合わせてAI（Claude）がページごとの課題と打ち手を診断します。
        </p>
      </div>

      {error && (
        <div
          className="rounded-[12px] px-4 py-2.5 mb-4 text-sm font-medium flex items-center gap-2"
          style={{ background: 'rgba(229,62,79,0.07)', border: '1px solid rgba(229,62,79,0.25)', color: '#c02637' }}
        >
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {loading ? (
        <div
          className="rounded-[16px] p-16 flex items-center justify-center gap-3"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}
        >
          <Loader2 size={18} className="animate-spin" style={{ color: 'var(--primary)' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>読み込み中...</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── 診断対象の選択 ── */}
          <div
            className="rounded-[14px] overflow-hidden"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
          >
            <div
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <Globe size={16} style={{ color: 'var(--primary)' }} />
                <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>診断対象ページ</h2>
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {selected.size} / {allPages.length} 選択中
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelected(new Set(allPages.map(p => p.url)))}
                  className="px-2.5 py-1 rounded-[7px] text-[11px] font-semibold transition-colors hover:bg-gray-100"
                  style={{ background: 'rgba(20,44,92,0.06)', color: 'var(--text-muted)' }}
                >
                  全選択
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="px-2.5 py-1 rounded-[7px] text-[11px] font-semibold transition-colors hover:bg-gray-100"
                  style={{ background: 'rgba(20,44,92,0.06)', color: 'var(--text-muted)' }}
                >
                  全解除
                </button>
              </div>
            </div>

            <div className="px-5 py-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
              {allPages.map(p => {
                const audited = doc?.pages?.[p.url]
                return (
                  <label
                    key={p.url}
                    className="flex items-center gap-2.5 py-1.5 cursor-pointer select-none min-w-0"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(p.url)}
                      onChange={() => toggle(p.url)}
                      className="rounded flex-shrink-0"
                      disabled={running}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold truncate" style={{ color: 'var(--ink)' }}>
                        {p.label}
                      </span>
                      <span className="block text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>
                        {p.url}
                      </span>
                    </span>
                    {audited?.ai && (
                      <span
                        className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
                        style={{ color: scoreColor(audited.ai.score), background: `${scoreColor(audited.ai.score)}18` }}
                      >
                        {audited.ai.score}点
                      </span>
                    )}
                  </label>
                )
              })}
            </div>

            {/* URL手動追加 */}
            <div
              className="flex flex-wrap items-center gap-2 px-5 py-3"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <input
                type="text"
                placeholder="https://nihon-teikei.co.jp/..."
                value={customUrl}
                onChange={e => setCustomUrl(e.target.value)}
                className="flex-1 min-w-[220px] text-[12px] px-3 py-1.5 rounded-[8px]"
                style={{ border: '1px solid var(--border)', background: 'white', color: 'var(--ink)' }}
                disabled={running}
              />
              <input
                type="text"
                placeholder="ページ名（任意）"
                value={customLabel}
                onChange={e => setCustomLabel(e.target.value)}
                className="w-[160px] text-[12px] px-3 py-1.5 rounded-[8px]"
                style={{ border: '1px solid var(--border)', background: 'white', color: 'var(--ink)' }}
                disabled={running}
              />
              <button
                onClick={handleAddCustom}
                disabled={running || !customUrl.trim()}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[8px] text-[12px] font-bold transition-colors hover:bg-gray-100 disabled:opacity-40"
                style={{ background: 'rgba(20,44,92,0.06)', color: 'var(--ink)' }}
              >
                <Plus size={13} />
                追加
              </button>
            </div>
          </div>

          {/* ── 実行CTA ── */}
          <div
            className="rounded-[16px] p-5 flex flex-wrap items-center justify-between gap-4"
            style={{
              background: 'linear-gradient(135deg, rgba(18,103,242,0.06) 0%, rgba(124,92,255,0.06) 100%)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="min-w-0">
              <p className="text-sm font-bold mb-1" style={{ color: 'var(--ink)' }}>
                ウェブ診断を実行
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                選択したページを1ページずつ取得・診断し、最後にサイト全体の総合サマリを生成します（1ページ約20〜30秒）。
              </p>
              {doc?.updatedAt && !running && (
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
                  最終診断: {fmtDateTime(doc.updatedAt)}
                </p>
              )}
              {running && progress && (
                <div className="mt-2.5">
                  <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--primary)' }}>
                    <Loader2 size={13} className="animate-spin" />
                    {progress.done < progress.total
                      ? `${progress.done + 1} / ${progress.total} 診断中: ${progress.current}`
                      : progress.current}
                  </div>
                  <div className="mt-1.5 h-1.5 w-full max-w-[320px] rounded-full overflow-hidden" style={{ background: 'rgba(20,44,92,0.08)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                        background: 'linear-gradient(90deg, #1267f2, #7c5cff)',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => void handleRun()}
              disabled={running || selected.size === 0}
              className="inline-flex items-center gap-2 min-h-[42px] px-5 rounded-[11px] text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #1267f2 0%, #7c5cff 100%)',
                boxShadow: '0 4px 14px rgba(18,103,242,0.32)',
              }}
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <ScanSearch size={16} />}
              {running ? '診断中...' : `選択した${selected.size}ページを診断`}
            </button>
          </div>

          {runErrors.length > 0 && (
            <div
              className="rounded-[12px] px-4 py-3 text-[13px] space-y-1"
              style={{ background: 'rgba(229,62,79,0.06)', border: '1px solid rgba(229,62,79,0.22)', color: '#c02637' }}
            >
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle size={14} />
                一部の診断に失敗しました
              </p>
              {runErrors.map((e, i) => (
                <p key={i} className="pl-5 break-all">{e}</p>
              ))}
            </div>
          )}

          {/* ── 診断履歴タブ ── */}
          {(hasAnyResult || history.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <span className="inline-flex items-center gap-1.5 text-[12px] font-bold mr-1" style={{ color: 'var(--text-muted)' }}>
                <History size={13} />
                診断履歴
              </span>
              <button
                onClick={() => setViewTab('latest')}
                className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors"
                style={
                  viewTab === 'latest'
                    ? { background: '#002C93', color: '#fff' }
                    : { background: 'rgba(20,44,92,0.06)', color: 'var(--text-muted)' }
                }
              >
                最新
              </button>
              {history.map(h => (
                <button
                  key={h.date}
                  onClick={() => setViewTab(h.date)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors"
                  style={
                    viewTab === h.date
                      ? { background: '#002C93', color: '#fff' }
                      : { background: 'rgba(20,44,92,0.06)', color: 'var(--text-muted)' }
                  }
                >
                  {fmtTabDate(h.date)}
                </button>
              ))}
              {view.isHistory && (
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ml-1"
                  style={{ background: 'rgba(245,158,11,0.12)', color: '#92600a' }}
                >
                  {view.dateLabel}の記録を表示中
                </span>
              )}
            </div>
          )}

          {!hasAnyResult && !running ? (
            <div
              className="rounded-[16px] p-14 text-center"
              style={{ background: 'var(--surface-raised)', border: '1.5px dashed var(--border)' }}
            >
              <p className="font-medium mb-1" style={{ color: 'var(--text-muted)' }}>まだ診断結果がありません</p>
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
                上のページ一覧から対象を選んで「診断」を実行してください
              </p>
            </div>
          ) : hasAnyResult && (
            <>
              {/* ── サイト全体スコア ── */}
              {scored.length > 0 && (
                <div
                  className="rounded-[16px] p-6 grid grid-cols-1 md:grid-cols-3 gap-6 items-center"
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
                >
                  <div className="flex items-center gap-5">
                    <ScoreRing score={avgScore} size={110} stroke={11} />
                    <div>
                      <p className="text-[12px] font-semibold mb-0.5" style={{ color: 'var(--text-muted)' }}>サイト平均スコア</p>
                      <p className="text-lg font-black" style={{ color: scoreColor(avgScore) }}>{scoreGrade(avgScore)}</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{scored.length}ページの平均</p>
                    </div>
                  </div>
                  <div className="md:col-span-2 space-y-2.5">
                    {[
                      { label: '良好（80点以上）', count: gradeCounts.good, color: '#0f9d58' },
                      { label: '要改善（60〜79点）', count: gradeCounts.warn, color: '#f59e0b' },
                      { label: '要対策（60点未満）', count: gradeCounts.bad, color: '#e53e4f' },
                    ].map(row => (
                      <div key={row.label} className="flex items-center gap-3">
                        <span className="text-[12px] font-semibold w-[140px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                          {row.label}
                        </span>
                        <div className="flex-1 h-4 rounded-full overflow-hidden" style={{ background: 'rgba(20,44,92,0.06)' }}>
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${(row.count / Math.max(1, scored.length)) * 100}%`, background: row.color }}
                          />
                        </div>
                        <span className="text-[13px] font-black w-10 text-right" style={{ color: row.color }}>
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── ファネルマップ ── */}
              <div
                className="rounded-[16px] p-6"
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Filter size={16} style={{ color: 'var(--primary)' }} />
                  <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>ファネルマップ（各ページの役割とスコア）</h2>
                </div>
                <p className="text-[12px] mb-5" style={{ color: 'var(--text-muted)' }}>
                  顧客が上から下へ進むマーケティングファネル上に、各ページがどのフェーズを担っているかを配置しています。ページ名をクリックすると詳細に移動します。
                </p>

                <div className="space-y-2">
                  {PHASES.map((phase, i) => {
                    const items = phasePages.get(phase.key) ?? []
                    const width = 100 - i * 7
                    return (
                      <div key={phase.key} className="flex justify-center">
                        <div
                          className="rounded-[12px] px-4 py-3"
                          style={{ width: `${width}%`, background: phase.gradient, boxShadow: '0 3px 10px rgba(10,30,80,0.14)' }}
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <div className="w-[150px] flex-shrink-0">
                              <p className="text-[13px] font-black text-white leading-tight">{phase.label}</p>
                              <p className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,0.75)' }}>{phase.desc}</p>
                            </div>
                            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                              {items.length === 0 ? (
                                <span className="text-[11px] font-semibold" style={{ color: 'rgba(255,255,255,0.65)' }}>
                                  対象ページなし
                                </span>
                              ) : (
                                items.map(({ def, result }) => (
                                  <button
                                    key={def.url}
                                    onClick={() => result && scrollToPage(def.url)}
                                    disabled={!result}
                                    className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-bold transition-transform hover:scale-[1.04] disabled:cursor-default"
                                    style={{ background: 'rgba(255,255,255,0.92)', color: '#0a1e50' }}
                                    title={def.url}
                                  >
                                    <span className="truncate max-w-[150px]">{def.label}</span>
                                    {result?.ai ? (
                                      <span
                                        className="inline-flex items-center justify-center min-w-[30px] px-1 py-0.5 rounded-full text-[10px] font-black text-white"
                                        style={{ background: scoreColor(result.ai.score) }}
                                      >
                                        {result.ai.score}
                                      </span>
                                    ) : (
                                      <span
                                        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                                        style={{ background: 'rgba(20,44,92,0.10)', color: '#64748B' }}
                                      >
                                        未診断
                                      </span>
                                    )}
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* ファネル外 */}
                  {(phasePages.get('other') ?? []).length > 0 && (
                    <div className="flex justify-center pt-1">
                      <div
                        className="rounded-[12px] px-4 py-3 w-full"
                        style={{ background: 'rgba(100,116,139,0.08)', border: '1px dashed rgba(100,116,139,0.35)' }}
                      >
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <div className="w-[150px] flex-shrink-0">
                            <p className="text-[13px] font-black leading-tight" style={{ color: '#475569' }}>{OTHER_PHASE.label}</p>
                            <p className="text-[10px] leading-tight" style={{ color: '#94A3B8' }}>{OTHER_PHASE.desc}</p>
                          </div>
                          <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                            {(phasePages.get('other') ?? []).map(({ def, result }) => (
                              <button
                                key={def.url}
                                onClick={() => result && scrollToPage(def.url)}
                                disabled={!result}
                                className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-bold transition-transform hover:scale-[1.04] disabled:cursor-default"
                                style={{ background: 'white', color: '#0a1e50', border: '1px solid var(--border)' }}
                                title={def.url}
                              >
                                <span className="truncate max-w-[150px]">{def.label}</span>
                                {result?.ai ? (
                                  <span
                                    className="inline-flex items-center justify-center min-w-[30px] px-1 py-0.5 rounded-full text-[10px] font-black text-white"
                                    style={{ background: scoreColor(result.ai.score) }}
                                  >
                                    {result.ai.score}
                                  </span>
                                ) : (
                                  <span
                                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                                    style={{ background: 'rgba(20,44,92,0.08)', color: '#64748B' }}
                                  >
                                    未診断
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── 総合サマリ ── */}
              {view.overall && (
                <div
                  className="rounded-[16px] p-6"
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>サイト全体の総合サマリ</h2>
                    <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      生成: {fmtDateTime(view.overall.generatedAt)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed mb-5 whitespace-pre-wrap" style={{ color: 'var(--ink)' }}>
                    {view.overall.summary}
                  </p>

                  <div className="mb-5">
                    <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>横断的な課題</p>
                    <ul className="space-y-2">
                      {view.overall.issues.map((s, i) => (
                        <li key={i} className="flex gap-2.5 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
                          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>打ち手（推奨アクション）</p>
                  <div className="space-y-3">
                    {view.overall.actions.map((a, i) => {
                      const pm = PRIORITY_META[a.priority]
                      return (
                        <div
                          key={i}
                          className="rounded-[12px] p-4"
                          style={{ background: 'rgba(18,103,242,0.03)', border: '1px solid var(--border)' }}
                        >
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span
                              className="inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
                              style={{ background: 'rgba(18,103,242,0.10)', color: '#1267f2' }}
                            >
                              <Target size={13} />
                            </span>
                            <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{a.title}</span>
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
                              style={{ color: pm.color, background: pm.bg }}
                            >
                              {pm.label}
                            </span>
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold"
                              style={{ color: 'var(--text-muted)', background: 'rgba(20,44,92,0.06)' }}
                            >
                              {a.category}
                            </span>
                          </div>
                          <p className="text-[13px] leading-relaxed pl-8" style={{ color: 'var(--text-muted)' }}>
                            {a.description}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── ページ別診断結果 ── */}
              <div className="space-y-4">
                <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>ページ別診断結果</h2>
                {viewedPages.map(r => {
                  const phaseMeta = PHASES.find(p => p.key === r.phase)
                  return (
                    <div
                      key={r.url}
                      id={pageAnchorId(r.url)}
                      className="rounded-[16px] p-5 scroll-mt-6"
                      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
                    >
                      <div className="flex flex-wrap items-start gap-4 mb-3">
                        {r.ai && <ScoreRing score={r.ai.score} size={64} stroke={7} />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{r.label}</span>
                            <span
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black text-white"
                              style={{ background: phaseMeta?.color ?? '#64748B' }}
                            >
                              {phaseMeta?.label ?? OTHER_PHASE.label}
                            </span>
                            {r.ai && (
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold"
                                style={{ color: scoreColor(r.ai.score), background: `${scoreColor(r.ai.score)}18` }}
                              >
                                {scoreGrade(r.ai.score)}
                              </span>
                            )}
                          </div>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] hover:underline break-all"
                            style={{ color: 'var(--text-faint)' }}
                          >
                            {r.url}
                          </a>
                          {(r.gsc || r.ga4) && (
                            <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
                              {r.gsc && (
                                <>GSC直近28日: クリック {fmtInt(r.gsc.clicks)} ／ 表示 {fmtInt(r.gsc.impressions)} ／ 平均順位 {r.gsc.position.toFixed(1)}　</>
                              )}
                              {r.ga4 && (
                                <>GA4直近28日: セッション {fmtInt(r.ga4.sessions)} ／ PV {fmtInt(r.ga4.pageViews)}</>
                              )}
                            </p>
                          )}
                        </div>
                        <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
                          診断: {fmtDateTime(r.generatedAt)}
                        </span>
                      </div>

                      {/* 技術チェックチップ */}
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {buildTechChips(r).map((c, i) => (
                          <TechChip key={i} status={c.status} label={c.label} />
                        ))}
                      </div>

                      {r.ai && (
                        <>
                          <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--ink)' }}>
                            {r.ai.summary}
                          </p>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <div
                              className="rounded-[10px] p-3.5"
                              style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.18)' }}
                            >
                              <p className="text-xs font-bold mb-2" style={{ color: '#92600a' }}>課題</p>
                              <ul className="space-y-1.5">
                                {r.ai.issues.map((s, i) => (
                                  <li key={i} className="text-[12px] leading-relaxed" style={{ color: 'var(--ink)' }}>
                                    ・{s}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div
                              className="rounded-[10px] p-3.5"
                              style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)' }}
                            >
                              <p className="text-xs font-bold mb-2" style={{ color: 'var(--primary)' }}>打ち手</p>
                              <ul className="space-y-2">
                                {r.ai.actions.map((a, i) => {
                                  const pm = PRIORITY_META[a.priority]
                                  return (
                                    <li key={i} className="text-[12px] leading-relaxed" style={{ color: 'var(--ink)' }}>
                                      <span className="font-bold">{a.title}</span>
                                      <span
                                        className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-bold ml-1.5 align-middle"
                                        style={{ color: pm.color, background: pm.bg }}
                                      >
                                        {pm.label}
                                      </span>
                                      <span className="block mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.description}</span>
                                    </li>
                                  )
                                })}
                              </ul>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* 再診断の注意 */}
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            <RefreshCw size={11} className="inline mr-1 -mt-0.5" />
            診断結果はS3に保存されます。診断を実行するたびに日付タブとして履歴が残り、過去の診断結果と見比べられます（同じ日の再診断はその日のタブを上書きします）。
          </p>
        </div>
      )}
    </div>
  )
}
