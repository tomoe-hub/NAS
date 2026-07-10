'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Crosshair,
  ExternalLink,
  History,
  Lightbulb,
  Loader2,
  RefreshCw,
  Search,
  Target,
  Users,
} from 'lucide-react'
import type {
  CompetitiveAnalysisDocument,
  CompetitiveAnalysisSnapshot,
  CompetitorConfig,
  KeywordOpportunity,
  StrategyPriority,
  StrategyPhase,
} from '@/lib/competitiveAnalysis'

type Tab = 'competitors' | 'comparison' | 'strategy'

const AXES = [
  { key: 'message', label: 'LP・メッセージ' },
  { key: 'pricing', label: '価格・利用条件' },
  { key: 'offering', label: '機能・提供範囲' },
  { key: 'positioning', label: 'ポジショニング' },
  { key: 'authority', label: '集客・権威性' },
] as const

const PRIORITY: Record<StrategyPriority, { label: string; color: string; gradient: string }> = {
  high: { label: '優先度 高', color: '#e53e4f', gradient: 'linear-gradient(90deg, #e53e4f, #f4708a)' },
  medium: { label: '優先度 中', color: '#f59e0b', gradient: 'linear-gradient(90deg, #f59e0b, #fbbf24)' },
  low: { label: '優先度 低', color: '#64748b', gradient: 'linear-gradient(90deg, #64748b, #94a3b8)' },
}

const PHASES: Record<StrategyPhase, { label: string; color: string }> = {
  awareness: { label: '認知', color: '#0ea5e9' },
  research: { label: '情報収集', color: '#14b8a6' },
  comparison: { label: '比較検討', color: '#f59e0b' },
  decision: { label: '意思決定', color: '#e53e4f' },
}

function fmtDate(iso?: string): string {
  if (!iso) return '未実行'
  return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function tabDate(date: string) {
  const [, month, day] = date.split('-').map(Number)
  return `${month}/${day}`
}

function asPercent(value: number) {
  return `${Math.round(value)}%`
}

export default function CompetitiveAnalysisPage() {
  const [config, setConfig] = useState<CompetitorConfig[]>([])
  const [document, setDocument] = useState<CompetitiveAnalysisDocument>({ updatedAt: '', competitors: {} })
  const [history, setHistory] = useState<CompetitiveAnalysisSnapshot[]>([])
  const [opportunities, setOpportunities] = useState<KeywordOpportunity[]>([])
  const [usage, setUsage] = useState<{ units_used_this_month: number; units_limit_per_month: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('competitors')
  const [viewDate, setViewDate] = useState('latest')
  const [urlDrafts, setUrlDrafts] = useState<Record<string, { label: string; url: string }>>({})

  const refresh = useCallback(async () => {
    const response = await fetch('/api/competitive-analysis', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? '競合分析データの取得に失敗しました')
    setConfig(body.config ?? [])
    setDocument(body.document ?? { updatedAt: '', competitors: {} })
    setHistory(body.history ?? [])
    setOpportunities(body.opportunities ?? [])
    setUsage(body.usage ?? null)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : '競合分析データの取得に失敗しました')
      } finally {
        setLoading(false)
      }
    })()
  }, [refresh])

  const view = useMemo(() => {
    if (viewDate !== 'latest') {
      const snapshot = history.find(item => item.date === viewDate)
      if (snapshot) return { document: snapshot.document, historical: true }
    }
    return { document, historical: false }
  }, [viewDate, history, document])

  const invoke = async (action: string, body: Record<string, unknown> = {}) => {
    setRunning(action)
    setError(null)
    try {
      const response = await fetch('/api/competitive-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error ?? '処理に失敗しました')
      await refresh()
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました')
      return null
    } finally {
      setRunning(null)
    }
  }

  const analyzeAll = async () => {
    setRunning('analyze-all')
    setError(null)
    try {
      for (const competitor of config) {
        const response = await fetch('/api/competitive-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'analyze-competitor', competitorId: competitor.id }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(`${competitor.name}: ${body.error ?? '分析に失敗しました'}`)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '競合分析に失敗しました')
    } finally {
      setRunning(null)
    }
  }

  const addMonitoringUrl = async (competitor: CompetitorConfig) => {
    const draft = urlDrafts[competitor.id]
    if (!draft?.url?.trim()) return
    try {
      const parsed = new URL(draft.url.trim())
      if (parsed.protocol !== 'https:' || !(parsed.hostname === competitor.domain || parsed.hostname.endsWith(`.${competitor.domain}`))) {
        throw new Error(`${competitor.domain} 配下のHTTPS URLを指定してください`)
      }
      const next = config.map(item => item.id === competitor.id
        ? { ...item, urls: [...item.urls, { url: parsed.toString(), label: draft.label.trim() || '監視ページ' }] }
        : item)
      setRunning('save-config')
      const response = await fetch('/api/competitive-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-config', config: next }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? '監視URLの保存に失敗しました')
      setUrlDrafts(prev => ({ ...prev, [competitor.id]: { label: '', url: '' } }))
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '監視URLの保存に失敗しました')
    } finally {
      setRunning(null)
    }
  }

  const report = view.document.report
  const isAnalyzed = (id: string) => Boolean(view.document.competitors[id]?.axes)

  if (loading) {
    return (
      <div className="w-full py-20 flex items-center justify-center gap-3">
        <Loader2 className="animate-spin" size={20} style={{ color: 'var(--primary)' }} />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>競合分析を読み込んでいます...</span>
      </div>
    )
  }

  return (
    <div className="w-full py-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <Crosshair size={21} />
            競合分析・戦略提案
          </h1>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--text-muted)' }}>
            競合の公式情報、自社SEO・サイト診断、仮説ペルソナを統合し、日本提携支援が次に実行する施策まで整理します。
          </p>
        </div>
        {usage && (
          <div className="rounded-[10px] px-3 py-2 text-[11px]" style={{ background: 'rgba(18,103,242,0.06)', border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Ahrefs API: </span>
            <strong style={{ color: 'var(--ink)' }}>{usage.units_used_this_month.toLocaleString()} / {usage.units_limit_per_month.toLocaleString()} units</strong>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-5 rounded-[12px] px-4 py-3 flex gap-2 text-sm" style={{ background: 'rgba(229,62,79,0.08)', border: '1px solid rgba(229,62,79,0.28)', color: '#c02637' }}>
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b mb-6" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-5">
          {([
            ['competitors', '競合一覧'],
            ['comparison', '比較・機会'],
            ['strategy', '戦略・施策'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="pb-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors"
              style={tab === key ? { color: '#002C93', borderColor: '#002C93' } : { color: 'var(--text-muted)', borderColor: 'transparent' }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5 pb-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold mr-1" style={{ color: 'var(--text-muted)' }}>
            <History size={12} />履歴
          </span>
          <button
            onClick={() => setViewDate('latest')}
            className="px-2.5 py-1 rounded-full text-[11px] font-bold"
            style={viewDate === 'latest' ? { background: '#002C93', color: '#fff' } : { background: 'rgba(20,44,92,0.06)', color: 'var(--text-muted)' }}
          >
            最新
          </button>
          {history.map(item => (
            <button
              key={item.date}
              onClick={() => setViewDate(item.date)}
              className="px-2.5 py-1 rounded-full text-[11px] font-bold"
              style={viewDate === item.date ? { background: '#002C93', color: '#fff' } : { background: 'rgba(20,44,92,0.06)', color: 'var(--text-muted)' }}
            >
              {tabDate(item.date)}
            </button>
          ))}
        </div>
      </div>

      {view.historical && (
        <div className="mb-5 rounded-[10px] px-3 py-2 text-[12px] font-semibold" style={{ background: 'rgba(245,158,11,0.10)', color: '#92600a' }}>
          過去の分析結果を表示しています。最新の情報に戻るには「最新」を選択してください。
        </div>
      )}

      {tab === 'competitors' && (
        <div className="space-y-5">
          <div className="rounded-[16px] p-5 flex flex-wrap justify-between gap-4" style={{ background: 'linear-gradient(135deg, rgba(18,103,242,0.06), rgba(124,92,255,0.06))', border: '1px solid var(--border)' }}>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>第1段階: 公式情報を5軸で収集</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                各社の登録URLを実際に確認し、観測できる事実だけを「訴求・価格・提供範囲・立ち位置・権威性」に整理します。出典はすべて公式サイト（Tier 1）です。
              </p>
            </div>
            <button
              onClick={() => void analyzeAll()}
              disabled={Boolean(running) || view.historical}
              className="inline-flex items-center gap-2 px-5 min-h-[42px] rounded-[11px] text-sm font-bold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #1267f2, #7c5cff)', boxShadow: '0 4px 14px rgba(18,103,242,0.28)' }}
            >
              {running === 'analyze-all' ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              {running === 'analyze-all' ? '全社を分析中...' : '全競合を分析'}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {config.map(competitor => {
              const result = view.document.competitors[competitor.id]
              return (
                <div key={competitor.id} className="rounded-[16px] p-5" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex gap-2 items-center">
                        <h2 className="font-bold text-sm" style={{ color: 'var(--ink)' }}>{competitor.name}</h2>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: competitor.type === 'direct' ? 'rgba(229,62,79,0.10)' : 'rgba(100,116,139,0.10)', color: competitor.type === 'direct' ? '#c02637' : '#475569' }}>
                          {competitor.type === 'direct' ? '直接競合' : '間接競合'}
                        </span>
                      </div>
                      <p className="text-[12px] mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{competitor.note}</p>
                    </div>
                    {result?.axes ? <CheckCircle2 size={18} style={{ color: '#0f9d58' }} /> : <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>未分析</span>}
                  </div>

                  <div className="space-y-1.5 mb-4">
                    {competitor.urls.map(page => (
                      <a key={page.url} href={page.url} target="_blank" rel="noreferrer" className="flex gap-1.5 items-center text-[11px] hover:underline" style={{ color: '#1267f2' }}>
                        <ExternalLink size={11} />{page.label}: {page.url}
                      </a>
                    ))}
                  </div>
                  {!view.historical && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      <input
                        value={urlDrafts[competitor.id]?.label ?? ''}
                        onChange={event => setUrlDrafts(prev => ({ ...prev, [competitor.id]: { label: event.target.value, url: prev[competitor.id]?.url ?? '' } }))}
                        placeholder="ページ名（任意）"
                        className="w-[115px] px-2 py-1 rounded-[7px] text-[11px]"
                        style={{ border: '1px solid var(--border)', background: 'white', color: 'var(--ink)' }}
                      />
                      <input
                        value={urlDrafts[competitor.id]?.url ?? ''}
                        onChange={event => setUrlDrafts(prev => ({ ...prev, [competitor.id]: { label: prev[competitor.id]?.label ?? '', url: event.target.value } }))}
                        placeholder="追加監視URL"
                        className="flex-1 min-w-[150px] px-2 py-1 rounded-[7px] text-[11px]"
                        style={{ border: '1px solid var(--border)', background: 'white', color: 'var(--ink)' }}
                      />
                      <button
                        onClick={() => void addMonitoringUrl(competitor)}
                        disabled={Boolean(running)}
                        className="px-2.5 py-1 rounded-[7px] text-[11px] font-bold disabled:opacity-50"
                        style={{ background: 'rgba(20,44,92,0.07)', color: 'var(--text-muted)' }}
                      >
                        URL追加
                      </button>
                    </div>
                  )}

                  {result?.axes ? (
                    <div className="space-y-2.5">
                      {AXES.map(axis => {
                        const facts = result.axes?.[axis.key] ?? []
                        return (
                          <div key={axis.key}>
                            <p className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>{axis.label}</p>
                            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink)' }}>
                              {facts[0]?.text ?? '公式ページから確認できませんでした'}
                            </p>
                          </div>
                        )
                      })}
                      <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>確認: {fmtDate(result.updatedAt)} / Tier 1: 公式サイト</p>
                    </div>
                  ) : (
                    <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>分析すると、ここに5軸の観測事実と出典が表示されます。</p>
                  )}

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => void invoke('analyze-competitor', { competitorId: competitor.id })}
                      disabled={Boolean(running) || view.historical}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-bold"
                      style={{ background: 'rgba(18,103,242,0.08)', color: '#1267f2' }}
                    >
                      {running === 'analyze-competitor' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                      {result?.axes ? '再収集' : '公式情報を収集'}
                    </button>
                    <button
                      onClick={() => void invoke('refresh-keywords', { competitorId: competitor.id })}
                      disabled={Boolean(running) || view.historical}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-bold"
                      style={{ background: 'rgba(20,44,92,0.06)', color: 'var(--text-muted)' }}
                    >
                      <BarChart3 size={12} />
                      {result?.keywords ? `Ahrefs更新（${result.keywords.length}KW）` : 'Ahrefs KWを取得'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'comparison' && (
        <div className="space-y-6">
          <div className="rounded-[16px] p-5" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <h2 className="text-base font-bold mb-1" style={{ color: 'var(--ink)' }}>第2段階: 競合の強みと検索機会</h2>
            <p className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>競合の公式サイトの観測事実と、Ahrefsのドメイン別オーガニックKWを自社のデータと照合します。</p>
            <div className="overflow-x-auto">
              <table className="min-w-[780px] w-full text-left text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th className="py-2 pr-4 font-bold">競合</th>
                    {AXES.map(axis => <th className="py-2 pr-4 font-bold" key={axis.key}>{axis.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {config.map(competitor => {
                    const axes = view.document.competitors[competitor.id]?.axes
                    return (
                      <tr key={competitor.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="py-3 pr-4 font-bold whitespace-nowrap" style={{ color: 'var(--ink)' }}>{competitor.name}</td>
                        {AXES.map(axis => (
                          <td key={axis.key} className="py-3 pr-4 align-top leading-relaxed max-w-[220px]" style={{ color: 'var(--text-muted)' }}>
                            {axes?.[axis.key][0]?.text ?? '—'}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-[16px] p-5" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="flex flex-wrap justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>検索KWの機会</h2>
                <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>「競合が上位なのに自社が未露出／弱い」KWを、Ahrefs取得済みデータから抽出します。</p>
              </div>
              <span className="px-2.5 py-1 rounded-full h-fit text-[11px] font-bold" style={{ background: 'rgba(18,103,242,0.08)', color: '#1267f2' }}>{opportunities.length}件</span>
            </div>
            {opportunities.length === 0 ? (
              <div className="py-10 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
                各競合で「Ahrefs KWを取得」を実行すると、ここにキーワード機会が表示されます。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[700px] w-full text-[12px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <th className="text-left py-2 pr-4">KW</th>
                      <th className="text-right py-2 pr-4">Vol.</th>
                      <th className="text-left py-2 pr-4">状況</th>
                      <th className="text-left py-2">上位競合</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opportunities.slice(0, 20).map(row => (
                      <tr key={row.keyword} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="py-2.5 pr-4 font-bold" style={{ color: 'var(--ink)' }}>{row.keyword}</td>
                        <td className="py-2.5 pr-4 text-right">{row.volume.toLocaleString()}</td>
                        <td className="py-2.5 pr-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: row.opportunity === 'gap' ? 'rgba(229,62,79,0.10)' : 'rgba(245,158,11,0.12)', color: row.opportunity === 'gap' ? '#c02637' : '#92600a' }}>
                            {row.opportunity === 'gap' ? '自社未露出' : '自社が弱い'}
                          </span>
                        </td>
                        <td className="py-2.5" style={{ color: 'var(--text-muted)' }}>{row.competitors.map(c => `${c.name}（${c.position ?? '—'}位）`).join(' / ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'strategy' && (
        <div className="space-y-6">
          <div className="rounded-[16px] p-5 flex flex-wrap justify-between gap-4" style={{ background: 'linear-gradient(135deg, rgba(18,103,242,0.06), rgba(124,92,255,0.06))', border: '1px solid var(--border)' }}>
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>第3段階: 日本提携支援の戦略・施策へ翻訳</p>
              <p className="text-xs mt-1 max-w-3xl" style={{ color: 'var(--text-muted)' }}>
                競合の観測事実、自社SEO・総合分析、仮説ペルソナをClaudeが統合し、フェーズ別の差別化機会と実行順を提案します。
              </p>
            </div>
            <button
              onClick={() => void invoke('generate-strategy')}
              disabled={Boolean(running) || view.historical}
              className="inline-flex items-center gap-2 px-5 min-h-[42px] rounded-[11px] text-sm font-bold text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #1267f2, #7c5cff)', boxShadow: '0 4px 14px rgba(18,103,242,0.28)' }}
            >
              {running === 'generate-strategy' ? <Loader2 size={16} className="animate-spin" /> : <Lightbulb size={16} />}
              {report ? '戦略を再生成' : '戦略・施策を生成'}
            </button>
          </div>

          {!report ? (
            <div className="rounded-[16px] p-14 text-center" style={{ background: 'var(--surface-raised)', border: '1.5px dashed var(--border)' }}>
              <p className="font-medium" style={{ color: 'var(--text-muted)' }}>まだ戦略レポートがありません</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-faint)' }}>先に競合情報を収集し、「戦略・施策を生成」を実行してください。</p>
            </div>
          ) : (
            <>
              <div className="rounded-[16px] p-6" style={{ background: 'linear-gradient(135deg, rgba(0,44,147,0.04), rgba(124,92,255,0.05))', border: '1px solid var(--border)' }}>
                <div className="flex justify-between gap-3 flex-wrap mb-3">
                  <h2 className="font-bold" style={{ color: 'var(--ink)' }}>結論: 日本提携支援が取るべき方向</h2>
                  <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{fmtDate(report.generatedAt)}</span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ink)' }}>{report.summary}</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-[16px] p-5" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                  <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--ink)' }}>観測事実</h2>
                  <ul className="space-y-2">
                    {report.observedFacts.map((item, index) => <li key={index} className="flex gap-2 text-[13px] leading-relaxed"><CheckCircle2 size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#0f9d58' }} /><span>{item}</span></li>)}
                  </ul>
                </div>
                <div className="rounded-[16px] p-5" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                  <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--ink)' }}>差別化の機会</h2>
                  <ul className="space-y-2">
                    {report.opportunities.map((item, index) => <li key={index} className="flex gap-2 text-[13px] leading-relaxed"><Lightbulb size={15} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} /><span>{item}</span></li>)}
                  </ul>
                </div>
              </div>

              <div className="rounded-[16px] p-6" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                <h2 className="font-bold mb-1" style={{ color: 'var(--ink)' }}>ポジショニングマップ</h2>
                <p className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>横軸: {report.positioning.xAxis} ／ 縦軸: {report.positioning.yAxis}</p>
                <div className="relative h-[300px] rounded-[12px] overflow-hidden" style={{ background: 'linear-gradient(135deg, #f8fbff, #f6f3ff)', border: '1px solid var(--border)' }}>
                  <div className="absolute left-1/2 top-0 bottom-0 border-l" style={{ borderColor: 'rgba(20,44,92,0.14)' }} />
                  <div className="absolute top-1/2 left-0 right-0 border-t" style={{ borderColor: 'rgba(20,44,92,0.14)' }} />
                  <span className="absolute left-3 bottom-2 text-[10px]" style={{ color: 'var(--text-faint)' }}>低い</span>
                  <span className="absolute right-3 bottom-2 text-[10px]" style={{ color: 'var(--text-faint)' }}>高い</span>
                  <span className="absolute left-3 top-2 text-[10px]" style={{ color: 'var(--text-faint)' }}>高い</span>
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: 'var(--text-faint)' }}>低い</span>
                  {report.positioning.points.map(point => (
                    <div key={point.name} className="absolute -translate-x-1/2 translate-y-1/2 group" style={{ left: `${Math.max(5, Math.min(95, point.x))}%`, bottom: `${Math.max(8, Math.min(94, point.y))}%` }}>
                      <div className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white whitespace-nowrap" style={{ background: point.isSelf ? '#002C93' : '#64748b', boxShadow: '0 3px 8px rgba(10,30,80,0.18)' }}>{point.name}</div>
                      <div className="hidden group-hover:block absolute z-10 left-1/2 -translate-x-1/2 mt-1 w-48 p-2 rounded-[8px] text-[10px] leading-relaxed" style={{ background: 'var(--ink)', color: 'white' }}>{point.rationale}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}><strong>狙う空白領域:</strong> {report.positioning.whitespace}</p>
              </div>

              <div className="rounded-[16px] p-6" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                <div className="flex gap-2 items-center mb-4"><Users size={16} style={{ color: '#1267f2' }} /><h2 className="font-bold" style={{ color: 'var(--ink)' }}>ペルソナ × ファネル別の競争状況</h2></div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  {(['awareness', 'research', 'comparison', 'decision'] as StrategyPhase[]).map(phase => {
                    const row = report.funnelCoverage.find(item => item.phase === phase)
                    const meta = PHASES[phase]
                    return <div key={phase} className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                      <div className="px-3 py-2 text-[12px] text-white font-black" style={{ background: meta.color }}>{meta.label}</div>
                      <div className="p-3 space-y-2 text-[11px] leading-relaxed">
                        <p><strong style={{ color: '#1267f2' }}>自社:</strong> {row?.self ?? '—'}</p>
                        <p><strong style={{ color: '#e53e4f' }}>競合:</strong> {row?.competitor ?? '—'}</p>
                        <p style={{ color: 'var(--text-muted)' }}><ChevronRight size={11} className="inline -mt-0.5" />{row?.implication ?? '—'}</p>
                      </div>
                    </div>
                  })}
                </div>
              </div>

              <div className="rounded-[16px] p-6" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}>
                <h2 className="font-bold mb-4" style={{ color: 'var(--ink)' }}>実行する施策</h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {(['high', 'medium', 'low'] as StrategyPriority[]).map(priority => {
                    const meta = PRIORITY[priority]
                    const actions = report.actions.filter(item => item.priority === priority)
                    return <div key={priority}>
                      <div className="rounded-t-[10px] px-3 py-2 text-white text-[12px] font-black" style={{ background: meta.gradient }}>{meta.label}（{actions.length}件）</div>
                      <div className="rounded-b-[10px] p-2.5 space-y-2 min-h-[100px]" style={{ background: 'rgba(18,103,242,0.03)', border: '1px solid var(--border)', borderTop: 'none' }}>
                        {actions.length === 0 ? <p className="text-center text-[11px] pt-5" style={{ color: 'var(--text-faint)' }}>なし</p> : actions.map((action, index) => (
                          <div key={index} className="rounded-[10px] p-3" style={{ background: 'white', border: '1px solid var(--border)' }}>
                            <div className="flex gap-1.5 items-center mb-1 flex-wrap"><Target size={12} style={{ color: '#1267f2' }} /><strong className="text-[12px]">{action.title}</strong><span className="px-1.5 py-0 rounded-full text-[10px]" style={{ color: PHASES[action.phase].color, background: `${PHASES[action.phase].color}18` }}>{PHASES[action.phase].label}</span></div>
                            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{action.description}</p>
                            <p className="mt-2 text-[10px]"><strong>対象:</strong> {action.target}</p>
                            <p className="text-[10px]"><strong>KPI:</strong> {action.kpi}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  })}
                </div>
              </div>

              {report.caveats.length > 0 && <div className="rounded-[12px] p-4 text-[12px]" style={{ background: 'rgba(100,116,139,0.06)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}><strong>データの読み方の注意</strong>{report.caveats.map((item, index) => <p key={index}>・{item}</p>)}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
