'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  Map,
  Target,
  Lightbulb,
  Quote,
  Search,
  Database,
} from 'lucide-react'

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

const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  高: { bg: 'rgba(220,38,38,0.1)', color: '#b91c1c' },
  中: { bg: 'rgba(230,126,34,0.12)', color: '#c2620c' },
  低: { bg: 'rgba(107,114,128,0.12)', color: '#4b5563' },
}

const PERSONA_COLORS = ['#1267F2', '#E67E22', '#0f9f6e', '#8b5cf6', '#db2777']

/** 箇条書きチップリスト */
function ChipList({ items, color }: { items: string[]; color?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={i}
          className="inline-block px-2.5 py-1 rounded-full text-xs leading-snug"
          style={{
            background: color ? `${color}14` : 'rgba(18,103,242,0.06)',
            color: 'var(--ink)',
            border: '1px solid var(--border)',
          }}
        >
          {item}
        </span>
      ))}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold mb-2" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
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

  return (
    <div className="w-full py-8 max-w-5xl mx-auto">
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--primary, #1267F2)' }}
        >
          {generating ? <RefreshCw size={15} className="animate-spin" /> : <Sparkles size={15} />}
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

      {/* ── ローディング / 未生成 ─────────────────── */}
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

          {/* ── ペルソナ切り替えタブ ───────────────── */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {doc.personas.map((p, i) => {
              const color = PERSONA_COLORS[i % PERSONA_COLORS.length]!
              const isActive = i === activeIdx
              return (
                <button
                  key={p.id || i}
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
                  style={{
                    background: isActive ? color : 'var(--surface-raised)',
                    color: isActive ? '#fff' : 'var(--ink)',
                    border: `1px solid ${isActive ? color : 'var(--border)'}`,
                  }}
                >
                  {p.name}
                </button>
              )
            })}
          </div>

          {/* ── ペルソナ詳細 ─────────────────────── */}
          {active && (
            <div
              className="rounded-[14px] p-6 sm:p-8 mb-6"
              style={{ background: 'var(--surface-raised)', border: `1px solid ${activeColor}30`, boxShadow: 'var(--shadow-sm)' }}
            >
              {/* 基本情報 */}
              <div className="pb-4 mb-5" style={{ borderBottom: `2px solid ${activeColor}30` }}>
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
                    <div key={label} className="rounded-lg p-2" style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)' }}>
                      <p style={{ color: 'var(--text-muted)' }}>{label}</p>
                      <p className="font-bold mt-0.5" style={{ color: 'var(--ink)' }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 引用 */}
              {active.quote && (
                <div className="flex items-start gap-2 rounded-[10px] p-4 mb-5" style={{ background: `${activeColor}0a`, border: `1px solid ${activeColor}25` }}>
                  <Quote size={16} className="flex-shrink-0 mt-0.5" style={{ color: activeColor }} />
                  <p className="text-sm italic leading-relaxed" style={{ color: 'var(--ink)' }}>{active.quote}</p>
                </div>
              )}

              {/* 背景 */}
              <div className="mb-5">
                <SectionLabel>背景・現在の状況</SectionLabel>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>{active.background}</p>
              </div>

              {/* 2カラム: ゴール・ペイン等 */}
              <div className="grid sm:grid-cols-2 gap-4 mb-5">
                {[
                  ['達成したいこと', active.goals],
                  ['不安・悩み', active.pains],
                  ['M&A検討のきっかけ', active.triggers],
                  ['意思決定の基準', active.decisionCriteria],
                  ['情報収集チャネル', active.infoSources],
                ].map(([label, items]) => (
                  <div key={label as string} className="rounded-[10px] p-4" style={{ background: 'rgba(18,103,242,0.03)', border: '1px solid var(--border)' }}>
                    <SectionLabel>{label as string}</SectionLabel>
                    <ul className="text-xs leading-relaxed space-y-1" style={{ color: 'var(--ink)' }}>
                      {(items as string[]).map((item, i) => (
                        <li key={i}>・{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="rounded-[10px] p-4" style={{ background: 'rgba(18,103,242,0.03)', border: '1px solid var(--border)' }}>
                  <SectionLabel><span className="inline-flex items-center gap-1"><Search size={12} />検索しそうなKW</span></SectionLabel>
                  <ChipList items={active.keywords} color={activeColor} />
                </div>
              </div>

              {/* カスタマージャーニー */}
              <div className="mb-5">
                <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                  <Map size={15} />
                  カスタマージャーニー
                </h3>
                <div className="overflow-x-auto rounded-[10px]" style={{ border: '1px solid var(--border)' }}>
                  <table className="w-full text-xs" style={{ minWidth: 760 }}>
                    <thead>
                      <tr style={{ background: `${activeColor}0d` }}>
                        {['フェーズ', '心理状態・行動', '接点', '求める情報', '離脱リスク（推測）', 'NTSの施策'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-bold whitespace-nowrap" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--border)' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {active.journey.map((stage, i) => (
                        <tr key={i} style={{ borderBottom: i < active.journey.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <td className="px-3 py-2.5 font-bold whitespace-nowrap align-top" style={{ color: activeColor }}>{stage.phase}</td>
                          <td className="px-3 py-2.5 align-top leading-relaxed" style={{ color: 'var(--ink)' }}>{stage.state}</td>
                          <td className="px-3 py-2.5 align-top leading-relaxed" style={{ color: 'var(--ink)' }}>{stage.touchpoints.join('、')}</td>
                          <td className="px-3 py-2.5 align-top leading-relaxed" style={{ color: 'var(--ink)' }}>{stage.needs}</td>
                          <td className="px-3 py-2.5 align-top leading-relaxed" style={{ color: 'var(--text-muted)' }}>{stage.barriers}</td>
                          <td className="px-3 py-2.5 align-top leading-relaxed font-medium" style={{ color: 'var(--ink)' }}>{stage.actions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* チャネル戦略 */}
              <div>
                <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                  <Target size={15} />
                  チャネル別戦略
                </h3>
                <div className="overflow-x-auto rounded-[10px]" style={{ border: '1px solid var(--border)' }}>
                  <table className="w-full text-xs" style={{ minWidth: 560 }}>
                    <thead>
                      <tr style={{ background: `${activeColor}0d` }}>
                        {['チャネル', '優先度', 'アプローチ'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-bold whitespace-nowrap" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--border)' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...active.channelStrategy]
                        .sort((a, b) => '高中低'.indexOf(a.priority) - '高中低'.indexOf(b.priority))
                        .map((cs, i, arr) => {
                          const style = PRIORITY_STYLE[cs.priority] ?? PRIORITY_STYLE['低']!
                          return (
                            <tr key={i} style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                              <td className="px-3 py-2.5 font-bold whitespace-nowrap align-top" style={{ color: 'var(--ink)' }}>{cs.channel}</td>
                              <td className="px-3 py-2.5 align-top">
                                <span className="inline-block px-2 py-0.5 rounded-full font-bold" style={{ background: style.bg, color: style.color }}>
                                  {cs.priority}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 align-top leading-relaxed" style={{ color: 'var(--ink)' }}>{cs.approach}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── 全体戦略の示唆 ───────────────────── */}
          {doc.overallInsights.length > 0 && (
            <div
              className="rounded-[14px] p-6 mb-6"
              style={{ background: 'var(--surface-raised)', border: '1px solid rgba(15,159,110,0.25)', boxShadow: 'var(--shadow-sm)' }}
            >
              <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: '#0f766e' }}>
                <Lightbulb size={15} />
                全ペルソナ横断のマーケティング戦略示唆
              </h3>
              <ul className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--ink)' }}>
                {doc.overallInsights.map((insight, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-bold flex-shrink-0" style={{ color: '#0f9f6e' }}>{i + 1}.</span>
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── 注意点（生存者バイアス等） ──────────── */}
          {doc.caveats.length > 0 && (
            <div
              className="rounded-[10px] p-4 flex items-start gap-3"
              style={{ background: 'rgba(230,126,34,0.05)', border: '1px solid rgba(230,126,34,0.25)' }}
            >
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#c2620c' }} />
              <div>
                <p className="text-xs font-bold mb-1.5" style={{ color: '#9a4d0a' }}>このペルソナの限界（仮説として扱ってください）</p>
                <ul className="text-xs leading-relaxed space-y-1" style={{ color: 'var(--text-muted)' }}>
                  {doc.caveats.map((c, i) => (
                    <li key={i}>・{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
