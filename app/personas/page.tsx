'use client'

import SectionTabs from '@/components/navigation/SectionTabs'
import { useState, useEffect, useCallback } from 'react'
import {
  Users,
  RefreshCw,
  AlertTriangle,
  Map,
  Target,
  Lightbulb,
  Quote,
  Search,
  Database,
  Eye,
  Scale,
  CheckCircle2,
  Handshake,
  Flag,
  Zap,
  AlertCircle,
  ListChecks,
  Newspaper,
  Filter,
  Megaphone,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface PersonaJourneyStage {
  phase: string
  state: string
  touchpoints: string[]
  needs: string
  barriers: string
  actions: string
}

interface PersonaChannelStrategy {
  channel: string
  priority: '高' | '中' | '低'
  approach: string
}

interface HypothesisPersona {
  id: string
  name: string
  tagline: string
  attributes: {
    age: string
    role: string
    industry: string
    companySize: string
    region: string
  }
  background: string
  goals: string[]
  pains: string[]
  triggers: string[]
  infoSources: string[]
  decisionCriteria: string[]
  quote: string
  keywords: string[]
  journey: PersonaJourneyStage[]
  channelStrategy: PersonaChannelStrategy[]
}

interface PersonaDocument {
  personas: HypothesisPersona[]
  overallInsights: string[]
  caveats: string[]
  dataSources: {
    interviewCount: number
    interviewTitles: string[]
    hasCaseStudies: boolean
    ahrefsKeywordCount: number
  }
  generatedAt: string
}

const PRIORITY_STYLE: Record<string, { bg: string; color: string; bar: number }> = {
  高: { bg: 'rgba(220,38,38,0.1)', color: '#b91c1c', bar: 100 },
  中: { bg: 'rgba(230,126,34,0.12)', color: '#c2620c', bar: 62 },
  低: { bg: 'rgba(107,114,128,0.12)', color: '#4b5563', bar: 30 },
}

const PERSONA_COLORS = ['#1267F2', '#E67E22', '#0f9f6e', '#8b5cf6', '#db2777']

/** ペルソナの顔写真（生成順に割り当て） */
const PERSONA_PHOTOS = [
  '/persona-photos/persona-1.png',
  '/persona-photos/persona-2.png',
  '/persona-photos/persona-3.png',
]

/** ジャーニーのフェーズ名からアイコンを推定 */
function phaseIcon(phase: string): LucideIcon {
  if (phase.includes('認知')) return Eye
  if (phase.includes('情報') || phase.includes('収集')) return Search
  if (phase.includes('比較') || phase.includes('検討')) return Scale
  if (phase.includes('意思') || phase.includes('決定') || phase.includes('決断')) return CheckCircle2
  if (phase.includes('成約') || phase.includes('契約') || phase.includes('後')) return Handshake
  return Flag
}

/** rgba文字列（HEX + アルファ） */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function ChipList({ items, color }: { items: string[]; color?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={i}
          className="inline-block px-2.5 py-1 rounded-full text-xs leading-snug"
          style={{
            background: color ? withAlpha(color, 0.07) : 'rgba(18,103,242,0.06)',
            color: 'var(--ink)',
            border: `1px solid ${color ? withAlpha(color, 0.25) : 'var(--border)'}`,
          }}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

export default function PersonasPage() {
  const [doc, setDoc] = useState<PersonaDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/personas', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled && res.ok) setDoc(data.document ?? null)
      } catch {
        /* 未生成として扱う */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [])

  const handleGenerate = useCallback(async () => {
    if (generating) return
    const confirmMsg = doc
      ? 'ペルソナを再生成しますか？\n最新のインタビュー記事・事例・KWデータをもとに作り直します（3〜5分程度かかります）。現在の内容は上書きされます。'
      : '仮説ペルソナを生成しますか？\nWordPressのインタビュー記事・事例集・Ahrefsデータをもとに生成します（3〜5分程度かかります）。'
    if (!window.confirm(confirmMsg)) return

    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/personas', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'ペルソナの生成に失敗しました')
      setDoc(data.document)
      setActiveIdx(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ペルソナの生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }, [doc, generating])

  const active = doc?.personas[activeIdx] ?? null
  const activeColor = PERSONA_COLORS[activeIdx % PERSONA_COLORS.length]!
  const activePhoto = PERSONA_PHOTOS[activeIdx % PERSONA_PHOTOS.length]!

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
      {/* ── ヘッダー ─────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <Users size={20} />
          仮説ペルソナ
        </h1>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || generating}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110 hover:-translate-y-px active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          style={{
            background: 'linear-gradient(160deg, #3d8bff 0%, #1267F2 45%, #0a4bc4 100%)',
            boxShadow: '0 4px 14px rgba(18,103,242,0.4), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 0 rgba(0,0,0,0.18)',
          }}
        >
          {generating && <RefreshCw size={15} className="animate-spin" />}
          {generating ? '生成中...（3〜5分）' : doc ? 'ペルソナを再生成' : 'ペルソナを生成'}
        </button>
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        M&A成約インタビュー・支援事例・検索KWデータから作成した、マーケティング戦略用の仮説ペルソナ（プロト・ペルソナ）です。
        インタビューが増えたら「再生成」で更新してください。
      </p>

      {error && (
        <div className="rounded-[10px] p-4 mb-6 text-sm text-red-700" style={{ background: 'rgba(220,38,38,0.05)', border: '1px solid rgba(220,38,38,0.2)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 justify-center text-sm" style={{ color: 'var(--text-muted)' }}>
          <RefreshCw size={16} className="animate-spin" />
          読み込み中...
        </div>
      ) : !doc ? (
        <div
          className="rounded-[14px] p-10 text-center"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <Users size={36} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-bold mb-1" style={{ color: 'var(--ink)' }}>まだペルソナが生成されていません</p>
          <p className="text-xs mb-0" style={{ color: 'var(--text-muted)' }}>
            右上の「ペルソナを生成」を押すと、WordPressのM&A成約インタビュー記事（非公開含む）・
            匿名事例集・Ahrefs検索KWデータをAIが分析し、3つの仮説ペルソナとカスタマージャーニーを作成します。
          </p>
        </div>
      ) : (
        <>
          {/* ── データソース ─────────────────────── */}
          <div
            className="rounded-[10px] p-4 mb-5 flex items-start gap-3 flex-wrap text-xs"
            style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <Database size={14} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-[240px]">
              <span className="font-bold" style={{ color: 'var(--ink)' }}>生成元データ: </span>
              成約インタビュー {doc.dataSources.interviewCount}件
              {doc.dataSources.hasCaseStudies ? '・匿名事例集' : ''}
              ・検索KWデータ {doc.dataSources.ahrefsKeywordCount}件
              <span className="ml-2">
                （生成日時: {new Date(doc.generatedAt).toLocaleString('ja-JP')}）
              </span>
              {doc.dataSources.interviewTitles.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer">参照したインタビュー記事</summary>
                  <ul className="mt-1 list-disc list-inside">
                    {doc.dataSources.interviewTitles.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>

          {/* ── ペルソナ切り替えタブ（顔写真つき） ──────── */}
          <div className="flex gap-2 mb-5 flex-wrap">
            {doc.personas.map((p, i) => {
              const color = PERSONA_COLORS[i % PERSONA_COLORS.length]!
              const photo = PERSONA_PHOTOS[i % PERSONA_PHOTOS.length]!
              const isActive = i === activeIdx
              return (
                <button
                  key={p.id || i}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className="inline-flex items-center gap-2 pl-1.5 pr-4 py-1.5 rounded-full text-sm font-bold transition-all"
                  style={{
                    background: isActive ? color : 'var(--surface-raised)',
                    color: isActive ? '#fff' : 'var(--ink)',
                    border: `1px solid ${isActive ? color : 'var(--border)'}`,
                    boxShadow: isActive ? `0 3px 10px ${withAlpha(color, 0.35)}` : 'none',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    style={{ border: `2px solid ${isActive ? 'rgba(255,255,255,0.7)' : withAlpha(color, 0.4)}` }}
                  />
                  {p.name}
                </button>
              )
            })}
          </div>

          {/* ── ペルソナ詳細 ─────────────────────── */}
          {active && (
            <div
              className="rounded-[14px] p-6 sm:p-8 mb-6"
              style={{ background: 'var(--surface-raised)', border: `1px solid ${withAlpha(activeColor, 0.2)}`, boxShadow: 'var(--shadow-sm)' }}
            >
              {/* プロフィールヘッダー */}
              <div className="flex flex-col sm:flex-row gap-5 pb-5 mb-5" style={{ borderBottom: `2px solid ${withAlpha(activeColor, 0.2)}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activePhoto}
                  alt={active.name}
                  className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl object-cover flex-shrink-0"
                  style={{
                    border: `3px solid ${withAlpha(activeColor, 0.35)}`,
                    boxShadow: `0 8px 20px ${withAlpha(activeColor, 0.25)}`,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-bold mb-1" style={{ color: activeColor }}>{active.name}</h2>
                  <p className="text-sm mb-3" style={{ color: 'var(--ink)' }}>{active.tagline}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    {[
                      ['年齢', active.attributes.age],
                      ['立場', active.attributes.role],
                      ['業種', active.attributes.industry],
                      ['規模', active.attributes.companySize],
                      ['地域', active.attributes.region],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg p-2" style={{ background: withAlpha(activeColor, 0.05), border: '1px solid var(--border)' }}>
                        <p style={{ color: 'var(--text-muted)' }}>{label}</p>
                        <p className="font-bold mt-0.5" style={{ color: 'var(--ink)' }}>{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 引用 */}
              {active.quote && (
                <div className="flex items-start gap-2 rounded-[10px] p-4 mb-5" style={{ background: withAlpha(activeColor, 0.05), border: `1px solid ${withAlpha(activeColor, 0.2)}` }}>
                  <Quote size={16} className="flex-shrink-0 mt-0.5" style={{ color: activeColor }} />
                  <p className="text-sm italic leading-relaxed" style={{ color: 'var(--ink)' }}>{active.quote}</p>
                </div>
              )}

              {/* 背景 */}
              <div className="mb-5">
                <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>背景・現在の状況</p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>{active.background}</p>
              </div>

              {/* ゴール・ペイン等（アイコンつきカード） */}
              <div className="grid sm:grid-cols-2 gap-4 mb-7">
                {([
                  ['達成したいこと', Target, active.goals],
                  ['不安・悩み', AlertCircle, active.pains],
                  ['M&A検討のきっかけ', Zap, active.triggers],
                  ['意思決定の基準', ListChecks, active.decisionCriteria],
                  ['情報収集チャネル', Newspaper, active.infoSources],
                ] as [string, LucideIcon, string[]][]).map(([label, Icon, items]) => (
                  <div key={label} className="rounded-[10px] p-4" style={{ background: withAlpha(activeColor, 0.03), border: '1px solid var(--border)' }}>
                    <p className="text-xs font-bold mb-2 inline-flex items-center gap-1.5" style={{ color: activeColor }}>
                      <Icon size={13} />
                      {label}
                    </p>
                    <ul className="text-xs leading-relaxed space-y-1" style={{ color: 'var(--ink)' }}>
                      {items.map((item, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="flex-shrink-0" style={{ color: withAlpha(activeColor, 0.6) }}>●</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="rounded-[10px] p-4" style={{ background: withAlpha(activeColor, 0.03), border: '1px solid var(--border)' }}>
                  <p className="text-xs font-bold mb-2 inline-flex items-center gap-1.5" style={{ color: activeColor }}>
                    <Search size={13} />
                    検索しそうなKW
                  </p>
                  <ChipList items={active.keywords} color={activeColor} />
                </div>
              </div>

              {/* ── カスタマージャーニー（タイムライン） ── */}
              <div className="mb-7">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                  <Map size={15} />
                  カスタマージャーニー
                </h3>
                <div className="relative">
                  {/* 接続線（デスクトップ） */}
                  <div
                    className="hidden md:block absolute top-[19px] h-[3px] rounded-full"
                    style={{
                      left: `${100 / active.journey.length / 2}%`,
                      right: `${100 / active.journey.length / 2}%`,
                      background: `linear-gradient(90deg, ${withAlpha(activeColor, 0.25)}, ${activeColor})`,
                    }}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    {active.journey.map((stage, i) => {
                        const Icon = phaseIcon(stage.phase)
                        return (
                          <div key={i} className="flex md:flex-col gap-3 md:gap-0">
                            {/* ノード */}
                            <div className="flex md:flex-col items-center gap-2 md:mb-2 flex-shrink-0">
                              <div
                                className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-white flex-shrink-0"
                                style={{
                                  background: `linear-gradient(150deg, ${withAlpha(activeColor, 0.75)}, ${activeColor})`,
                                  boxShadow: `0 3px 10px ${withAlpha(activeColor, 0.4)}, inset 0 1px 0 rgba(255,255,255,0.3)`,
                                }}
                              >
                                <Icon size={17} />
                              </div>
                              <p className="text-xs font-bold md:text-center" style={{ color: activeColor }}>{stage.phase}</p>
                            </div>
                            {/* フェーズカード */}
                            <div className="flex-1 rounded-[10px] p-3 space-y-2.5 text-xs" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                              <div>
                                <p className="font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>心理・行動</p>
                                <p className="leading-relaxed" style={{ color: 'var(--ink)' }}>{stage.state}</p>
                              </div>
                              <div>
                                <p className="font-bold mb-1" style={{ color: 'var(--text-muted)' }}>接点</p>
                                <div className="flex flex-wrap gap-1">
                                  {stage.touchpoints.map((t, j) => (
                                    <span key={j} className="px-1.5 py-0.5 rounded text-[11px] leading-snug" style={{ background: withAlpha(activeColor, 0.08), color: 'var(--ink)' }}>
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <p className="font-bold mb-0.5" style={{ color: 'var(--text-muted)' }}>求める情報</p>
                                <p className="leading-relaxed" style={{ color: 'var(--ink)' }}>{stage.needs}</p>
                              </div>
                              <div className="rounded p-1.5" style={{ background: 'rgba(230,126,34,0.06)' }}>
                                <p className="font-bold mb-0.5 inline-flex items-center gap-1" style={{ color: '#c2620c' }}>
                                  <AlertTriangle size={10} />
                                  離脱リスク
                                </p>
                                <p className="leading-relaxed" style={{ color: 'var(--text-muted)' }}>{stage.barriers}</p>
                              </div>
                              <div className="rounded p-1.5" style={{ background: withAlpha(activeColor, 0.07), border: `1px solid ${withAlpha(activeColor, 0.18)}` }}>
                                <p className="font-bold mb-0.5 inline-flex items-center gap-1" style={{ color: activeColor }}>
                                  <Megaphone size={10} />
                                  NTSの施策
                                </p>
                                <p className="leading-relaxed font-medium" style={{ color: 'var(--ink)' }}>{stage.actions}</p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              </div>

              {/* ── マーケティングファネル ─────────────── */}
              <div className="mb-7">
                <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                  <Filter size={15} />
                  マーケティングファネル × タッチポイント
                </h3>
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                  フェーズが進むほど検討が深まり対象が絞られます。各段階で有効な接点を右に示しています。
                </p>
                <div className="space-y-1.5">
                  {active.journey.map((stage, i) => {
                    const n = active.journey.length
                    const width = 100 - (i * 54) / Math.max(n - 1, 1) // 100% → 46%
                    const alpha = 0.55 + (i * 0.4) / Math.max(n - 1, 1) // 0.55 → 0.95
                    return (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                        <div className="sm:w-[58%] flex justify-center">
                          <div
                            className="py-2.5 px-3 text-center text-xs font-bold text-white"
                            style={{
                              width: `${width}%`,
                              minWidth: 120,
                              background: `linear-gradient(150deg, ${withAlpha(activeColor, alpha - 0.12)}, ${withAlpha(activeColor, alpha)})`,
                              clipPath: 'polygon(2.5% 0%, 97.5% 0%, 94% 100%, 6% 100%)',
                              textShadow: '0 1px 2px rgba(0,0,0,0.25)',
                            }}
                          >
                            {stage.phase}
                          </div>
                        </div>
                        <div className="sm:flex-1 flex flex-wrap gap-1 justify-center sm:justify-start pb-2 sm:pb-0">
                          {stage.touchpoints.map((t, j) => (
                            <span key={j} className="px-2 py-0.5 rounded-full text-[11px] leading-snug" style={{ background: withAlpha(activeColor, 0.07), border: `1px solid ${withAlpha(activeColor, 0.2)}`, color: 'var(--ink)' }}>
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── チャネル別戦略（カード＋優先度バー） ──── */}
              <div>
                <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                  <Target size={15} />
                  チャネル別戦略
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[...active.channelStrategy]
                    .sort((a, b) => '高中低'.indexOf(a.priority) - '高中低'.indexOf(b.priority))
                    .map((cs, i) => {
                      const style = PRIORITY_STYLE[cs.priority] ?? PRIORITY_STYLE['低']!
                      return (
                        <div key={i} className="rounded-[10px] p-4" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{cs.channel}</p>
                            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0" style={{ background: style.bg, color: style.color }}>
                              優先度 {cs.priority}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full mb-2.5 overflow-hidden" style={{ background: 'rgba(107,114,128,0.12)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${style.bar}%`,
                                background: `linear-gradient(90deg, ${withAlpha(activeColor, 0.5)}, ${activeColor})`,
                              }}
                            />
                          </div>
                          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink)' }}>{cs.approach}</p>
                        </div>
                      )
                    })}
                </div>
              </div>
            </div>
          )}

          {/* ── 全体戦略の示唆（番号つきカード） ────────── */}
          {doc.overallInsights.length > 0 && (
            <div
              className="rounded-[14px] p-6 mb-6"
              style={{ background: 'var(--surface-raised)', border: '1px solid rgba(15,159,110,0.25)', boxShadow: 'var(--shadow-sm)' }}
            >
              <h3 className="text-sm font-bold mb-4 flex items-center gap-1.5" style={{ color: '#0f766e' }}>
                <Lightbulb size={15} />
                全ペルソナ横断のマーケティング戦略示唆
              </h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {doc.overallInsights.map((insight, i) => (
                  <div key={i} className="flex gap-3 rounded-[10px] p-3.5" style={{ background: 'rgba(15,159,110,0.04)', border: '1px solid rgba(15,159,110,0.15)' }}>
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{
                        background: 'linear-gradient(150deg, #14b8a6, #0f766e)',
                        boxShadow: '0 2px 6px rgba(15,159,110,0.35)',
                      }}
                    >
                      {i + 1}
                    </span>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--ink)' }}>{insight}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </>
      )}
    </div>
  )
}
