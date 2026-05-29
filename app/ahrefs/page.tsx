'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { AhrefsDataset } from '@/lib/ahrefsCsvParser'
import type { DatasetMeta } from '@/lib/ahrefsCsvParser'
import {
  analyzeKeywords,
  detectTrends,
  mergeAndAnalyze,
  mergeAndAnalyzeOrganic,
  type ScoredKeyword,
  type PriorityLevel,
} from '@/lib/ahrefsAnalyzer'
import { getAllArticles } from '@/lib/articleStorage'
import {
  buildKeywordWpEntriesByKeyword,
  keywordActionButtonLabel,
  normalizeKeywordForArticleMatch,
} from '@/lib/keywordPublishIndex'
import { ColumnHint } from '@/components/ui/ColumnHint'
import { Upload, X, Search, TrendingUp, TrendingDown, BarChart3, ChevronDown } from 'lucide-react'
import { loadMemos, saveMemos, migrateLocalStorageToS3 } from '@/lib/keywordMemoStorage'

type TabKey = 'opportunity' | 'organic' | 'trends'
const PAGE_SIZE = 50

/** Ahrefs 各列の説明（ⓘ でポータル表示） */
const AHREFS_COLUMN_HINTS = {
  keyword: 'Ahrefsが分析対象とする検索クエリ（Keywords Explorer / Site Explorer）。',
  volume: '対象国の月間検索回数の推定（平均）。Keywords Explorer / Site Explorer の指標。',
  kd: 'そのキーワードで上位に表示される難しさを表す数字で、数字が高いほど競合が強くて難しく、低いほど比較的上位を狙えます。',
  cpc: '有料検索におけるクリック単価の目安（データの通貨に依存）。',
  priorityKeywords:
    '狙い目KW：ボリューム・KD・スコア・SVトレンドから算出した優先度です。',
  priorityOrganic:
    '競合KW：順位・流入変動・ボリューム・SVトレンドから算出します（KD は使いません）。',
  trend: 'SV Trend 列から算出した、検索ボリューム推移の上昇・下降の傾向。',
  memo: 'ユーザーが自由に入力できるメモ欄です。クラウド（S3）に自動保存されるため、端末・ブラウザをまたいで参照できます。',
  position: 'オーガニック検索での現在の順位（Site Explorer）。',
  trafficChange: '推定オーガニックトラフィックの前回比の変化。',
  action:
    '記事作成画面へ遷移します。保存済み記事のターゲットKWと一致する場合、公開日・予約を表示します。',
} as const

export default function AhrefsPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [datasets, setDatasets] = useState<AhrefsDataset[]>([])
  const [index, setIndex] = useState<DatasetMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('opportunity')
  const [selectedPriority, setSelectedPriority] = useState<'all' | PriorityLevel>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCount, setShowCount] = useState(PAGE_SIZE)
  const [error, setError] = useState<string | null>(null)
  const [savedArticles, setSavedArticles] = useState<Awaited<ReturnType<typeof getAllArticles>>>([])
  const [keywordMemos, setKeywordMemos] = useState<Record<string, string>>({})

  const refreshSavedArticles = useCallback(async () => {
    setSavedArticles(await getAllArticles())
  }, [])

  useEffect(() => {
    void refreshSavedArticles()
  }, [refreshSavedArticles])

  useEffect(() => {
    void (async () => {
      const s3Memos = await loadMemos()
      // localStorage に残っている古いデータがあれば S3 にマイグレーション
      const merged = await migrateLocalStorageToS3(s3Memos)
      setKeywordMemos(merged)
    })()
  }, [])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void refreshSavedArticles()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refreshSavedArticles])

  const keywordWpMap = useMemo(
    () => buildKeywordWpEntriesByKeyword(savedArticles),
    [savedArticles],
  )

  const getMemoKey = useCallback((tab: TabKey, keyword: string) => {
    return `${tab}:${normalizeKeywordForArticleMatch(keyword)}`
  }, [])

  const getKeywordMemo = useCallback(
    (tab: TabKey, keyword: string) => keywordMemos[getMemoKey(tab, keyword)] ?? '',
    [getMemoKey, keywordMemos],
  )

  const handleMemoChange = useCallback((tab: TabKey, keyword: string, value: string) => {
    const key = getMemoKey(tab, keyword)
    setKeywordMemos(prev => {
      const next = { ...prev }
      if (value.trim()) {
        next[key] = value
      } else {
        delete next[key]
      }
      // S3 に保存（debounce 1.5秒・localStorage キャッシュも同時更新）
      saveMemos(next)
      return next
    })
  }, [getMemoKey])

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/ahrefs')
      const data = await res.json()
      setDatasets(data.datasets || [])
      setIndex(data.index || [])
    } catch {
      setError('データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        if (!file.name.endsWith('.csv')) continue
        const form = new FormData()
        form.append('file', file)
        const res = await fetch('/api/ahrefs', { method: 'POST', body: form })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'アップロードに失敗しました')
        }
      }
      await fetchData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }, [fetchData])

  const handleDeleteDataset = useCallback(async (id: string) => {
    if (!confirm('このデータセットを削除しますか？')) return
    try {
      await fetch(`/api/ahrefs?id=${id}`, { method: 'DELETE' })
      await fetchData()
    } catch {
      setError('削除に失敗しました')
    }
  }, [fetchData])

  // ----- Scored data -----

  const kwDatasets = useMemo(() => datasets.filter(d => d.type === 'keywords'), [datasets])
  const organicDatasets = useMemo(() => datasets.filter(d => d.type === 'organic'), [datasets])
  const allKeywords = useMemo(() => datasets.flatMap(d => d.keywords), [datasets])

  const opportunityScored = useMemo(
    () => mergeAndAnalyze(kwDatasets.map(d => d.keywords)),
    [kwDatasets],
  )
  const organicScored = useMemo(
    () => mergeAndAnalyzeOrganic(organicDatasets.map(d => d.keywords)),
    [organicDatasets],
  )
  const trendScored = useMemo(() => detectTrends(allKeywords), [allKeywords])

  const activeData = useMemo(() => {
    switch (activeTab) {
      case 'opportunity': return opportunityScored
      case 'organic': return organicScored
      case 'trends': return trendScored
    }
  }, [activeTab, opportunityScored, organicScored, trendScored])

  // Reset filters on tab change
  useEffect(() => {
    setShowCount(PAGE_SIZE)
    setSelectedPriority('all')
  }, [activeTab])

  // Filter & search
  const filtered = useMemo(() => {
    let data = activeData
    if (selectedPriority !== 'all') {
      data = data.filter(k => k.priority === selectedPriority)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      data = data.filter(k =>
        k.keyword.toLowerCase().includes(q) ||
        k.parentTopic.toLowerCase().includes(q) ||
        getKeywordMemo(activeTab, k.keyword).toLowerCase().includes(q)
      )
    }
    return data
  }, [activeData, activeTab, getKeywordMemo, selectedPriority, searchQuery])

  const displayed = filtered.slice(0, showCount)

  // Stats from activeData
  const activeTotal = activeData.length
  const p3Count = activeData.filter(k => k.priority === 3).length
  const p2Count = activeData.filter(k => k.priority === 2).length
  const trendUpCount = activeData.filter(k => k.trend === 'up').length

  const isOrganicTab = activeTab === 'organic'

  // ----- Auto-prompt generation (NTS) -----

  const generateAutoPrompt = useCallback((row: ScoredKeyword): string => {
    const volStrategy = row.volume > 5000
      ? '検索ボリュームが非常に大きいキーワードです。包括的かつ網羅的な内容にし、関連キーワードも幅広くカバーしてください。'
      : row.volume > 1000
        ? '中程度のボリュームがあります。幅広い検索意図をカバーする構成にしてください。'
        : row.volume > 300
          ? 'ニッチな専門性と具体性で上位を狙える領域です。深堀りした実務情報を盛り込んでください。'
          : '深い専門知識と具体的な事例で差別化してください。ロングテール戦略として有効です。'

    const kdStrategy = row.kd <= 10
      ? '競合がほぼ不在です。基本を丁寧に押さえれば上位表示が可能です。'
      : row.kd <= 30
        ? '独自視点で差別化すれば上位の勝算があります。NTSの実績や事例を活用してください。'
        : row.kd <= 50
          ? '実体験・具体的数値での差別化が必要です。NTSの支援事例やデータを積極的に引用してください。'
          : '高難度KWです。現場知見・独自データで差別化が必須です。NTSならではの独自分析を前面に出してください。'

    const cpcStrategy = row.cpc > 1000
      ? 'CPCが高く商業的意図が強いKWです。具体的なCTAを設置し、無料相談・資料DLへ誘導してください。'
      : row.cpc > 300
        ? '一定の商業的価値があります。サービスページや問い合わせフォームへの自然な誘導を含めてください。'
        : '情報収集段階のユーザーが多い可能性があります。信頼構築を重視し、まず価値提供に注力してください。'

    let trendNote = ''
    if (row.trend === 'up') {
      trendNote = `\n▸ トレンド注記: 検索ボリュームが上昇傾向（+${row.trendPercent}%）です。最新の市場動向・法改正・統計データを積極的に取り入れてください。`
    } else if (row.trend === 'down') {
      trendNote = `\n▸ トレンド注記: 検索ボリュームが下降傾向（${row.trendPercent}%）です。「今こそ知っておくべき」等の切り口で再注目を促してください。`
    }

    const categoryIntents: Record<string, string> = {
      'M&A全般': '\n・M&Aの基本的な流れ・手数料体系・メリットとリスクを知りたい\n・中小企業のM&A成功事例・失敗事例を知りたい',
      '事業承継': '\n・後継者不在の解決策を知りたい\n・親族内承継と第三者承継の違い・それぞれのメリットを理解したい\n・事業承継税制の活用方法を知りたい',
      '企業価値評価': '\n・自社の企業価値を知りたい\n・デューデリジェンスの具体的な進め方・チェックポイントを理解したい\n・バリュエーション手法（DCF、類似企業比較等）の違いを知りたい',
      'PMI・統合': '\n・M&A後の統合プロセス（PMI）の進め方を知りたい\n・買収後の「磨き上げ」で企業価値を高める方法を知りたい\n・従業員のモチベーション維持・組織文化統合のポイントを知りたい',
      'アドバイザー・仲介': '\n・M&Aアドバイザーの選び方・比較ポイントを知りたい\n・仲介手数料の相場・料金体系を理解したい\n・信頼できる相談先を見つけたい',
      '資金調達・補助金': '\n・M&Aに使える補助金・助成金制度を知りたい\n・買収資金の調達方法（LBO、銀行融資等）を理解したい\n・事業再構築補助金の活用事例を知りたい',
      '中小企業経営': '\n・中小企業の経営改善・収益向上策を知りたい\n・事業計画の策定方法を知りたい\n・経営課題の優先順位付けの方法を知りたい',
      '法務・税務': '\n・M&Aに関わる法務手続き・契約書のポイントを知りたい\n・M&Aの税務影響・節税策を知りたい\n・株式譲渡と事業譲渡の法的・税務的違いを理解したい',
    }
    const extraIntents = categoryIntents[row.detectedCategory] ?? ''

    const priorityLabel = row.priority === 3 ? '★★★即攻め' : row.priority === 2 ? '★★有望' : row.priority === 1 ? '★余力' : '対象外'

    return `あなたはM&A・事業承継領域に精通したコンテンツ戦略コンサルタントです。
以下のキーワードデータに基づき、NTS（日本提携支援）の公式コラムとして、検索流入の獲得とE-E-A-Tの訴求を両立した記事を執筆してください。

■テーマ
${row.keyword}

■KWデータに基づく執筆方針
・ターゲットキーワード: ${row.keyword}
・月間検索ボリューム: ${row.volume.toLocaleString()}
・KD（Keyword Difficulty）: ${row.kd}
・CPC: ¥${Math.round(row.cpc).toLocaleString()}
・カテゴリ: ${row.detectedCategory}
・優先度: ${priorityLabel}（スコア: ${row.score}）

▸ ボリューム戦略: ${volStrategy}
▸ KD戦略: ${kdStrategy}
▸ CPC戦略: ${cpcStrategy}${trendNote}

■検索意図の整理
このキーワードで検索するユーザーは以下の情報を求めていると想定されます：
・基本的な概念・定義を理解したい
・具体的な手順・プロセスを知りたい
・費用・相場感を把握したい
・成功事例・失敗事例から学びたい
・信頼できる専門家に相談したい${extraIntents}

■ターゲット
・中小企業の経営者・オーナー
・事業承継を検討中の経営者
・M&Aを初めて検討する企業の経営層・担当者

■必須条件
・NTS（日本提携支援）のM&Aアドバイザリーとしての専門知識・実績を反映すること
・一次執筆時にシステムが読み込む社内資料（S3の日本提携支援向けマテリアル等）を前提に、資料に基づく具体性・独自の現場知を記事に織り込むこと（メタに「資料」「S3」と書かないこと）
・実務に基づいた具体的なアドバイスを含めること
・読者が次のアクションを取りやすいよう、相談窓口やサービスページへの誘導を自然に含めること
・公的機関（中小企業庁、経済産業省等）の統計やガイドラインを適宜引用すること

■トーン・文体（厳守）
・NTSに言及するときは「私たちは〜」「弊社では〜」「NTSでは〜」と自社視点で書くこと。「NTSは確信している」のように三人称で客体化しない。
・文末は「〜です」「〜ます」「〜と考えています」のように丁寧語で統一。「〜だろう」「〜であろう」「〜に他ならない」のような評論家調・学術論文調は禁止。
・「徹底解説する」「完全ガイド」のような煽り表現は使わない。

■キーワード表記（厳守）
・ターゲットキーワードは本文中に自然な日本語として溶け込ませること。「」（鉤括弧）で囲んで繰り返さない。
・半角小文字のまま本文に出さない（例: m&a 相談 → M&Aの相談、M&Aについて相談する）。M&Aは常に大文字表記。

■品質要件
・2500文字以上の読み応えある記事にすること
・専門用語は必ず平易な説明を併記
・冗長な表現を避け、実務で役立つ情報密度の高い記事にすること
・NTSの専門性・信頼性が伝わるトーンで統一
・記事末尾に「よくある質問（FAQ）」セクション（Q&A形式で5問程度）を含めること`
  }, [])

  const handleWriteArticle = useCallback((row: ScoredKeyword) => {
    const params = new URLSearchParams({
      kwTarget: row.keyword,
      kwPrompt: generateAutoPrompt(row),
    })
    router.push(`/editor?${params.toString()}`)
  }, [router, generateAutoPrompt])

  // ----- Render -----

  if (loading) {
    return (
      <div className="w-full py-16 text-center">
        <div className="inline-block w-8 h-8 border-2 border-[#002C93] border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-sm text-[#64748B]">データを読み込み中...</p>
      </div>
    )
  }

  return (
    <div
      className="w-full py-8"
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files) }}
    >
      {dragOver && (
        <div className="fixed inset-0 bg-[#002C93]/10 border-2 border-dashed border-[#002C93] rounded-xl z-50 pointer-events-none flex items-center justify-center">
          <p className="text-[#002C93] font-semibold text-lg">CSVをドロップしてインポート</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-bold tracking-[0.11em] uppercase mb-1" style={{ color: 'var(--primary)' }}>
            Insight Dashboard
          </p>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>KW分析ダッシュボード</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Ahrefs CSVをインポートして、狙い目キーワードを分析</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-[10px] text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
              boxShadow: '0 4px 14px rgba(18,103,242,0.35), inset 0 1px 0 rgba(255,255,255,0.22)',
            }}
          >
            <Upload size={16} />
            {uploading ? 'インポート中...' : 'CSVインポート'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}

      {/* Dataset badges */}
      {index.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {index.map(meta => {
            const isKw = meta.type === 'keywords'
            const dateStr = (() => {
              try {
                const d = new Date(meta.uploadedAt)
                return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
              } catch { return '' }
            })()
            return (
              <span
                key={meta.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border"
                style={{
                  backgroundColor: isKw ? '#EFF6FF' : '#FFF7ED',
                  borderColor: isKw ? '#BFDBFE' : '#FED7AA',
                  color: isKw ? '#1D4ED8' : '#C2410C',
                }}
              >
                <span className="font-bold">{isKw ? 'KW' : '競合'}</span>
                <span className="font-medium truncate max-w-[180px]">{meta.fileName}</span>
                <span className="font-medium">{meta.rowCount}件</span>
                {dateStr && <span className="text-[10px] opacity-70">{dateStr}</span>}
                <button
                  onClick={() => handleDeleteDataset(meta.id)}
                  className="ml-0.5 hover:opacity-70"
                  aria-label={`${meta.fileName} を削除`}
                >
                  <X size={12} />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {datasets.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-[#E2E8F0]">
          <BarChart3 size={48} className="mx-auto text-[#CBD5E1] mb-4" />
          <h2 className="text-lg font-semibold text-[#1A1A2E] mb-2">データがありません</h2>
          <p className="text-sm text-[#64748B] mb-6">Ahrefs CSVをインポートして分析を始めましょう</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#002C93' }}
          >
            <Upload size={16} />
            CSVインポート
          </button>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <SummaryCard label="KW総数" value={activeTotal} color="#002C93" />
            <SummaryCard label="★★★ 即攻め" value={p3Count} color="#D97706" />
            <SummaryCard label="★★ 有望" value={p2Count} color="#2563EB" />
            <SummaryCard label="トレンドKW" value={trendUpCount} icon={<TrendingUp size={16} />} color="#16A34A" />
          </div>

          {/* Priority filter */}
          <div className="flex flex-wrap gap-2 mb-3">
            {([
              { key: 'all' as const, label: 'すべて', count: activeTotal },
              { key: 3 as const, label: '★★★ 即攻め', count: p3Count },
              { key: 2 as const, label: '★★ 有望', count: p2Count },
              { key: 1 as const, label: '★ 余力', count: activeData.filter(k => k.priority === 1).length },
              { key: 0 as const, label: '対象外', count: activeData.filter(k => k.priority === 0).length },
            ]).map(pill => (
              <button
                key={String(pill.key)}
                onClick={() => setSelectedPriority(pill.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  selectedPriority === pill.key
                    ? 'bg-[#002C93] text-white border-[#002C93]'
                    : 'bg-white text-[#64748B] border-[#E2E8F0] hover:border-[#002C93] hover:text-[#002C93]'
                }`}
              >
                {pill.label} ({pill.count})
              </button>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-6 mb-4 border-b border-[#E2E8F0]">
            {([
              { key: 'opportunity', label: '狙い目KW' },
              { key: 'organic', label: '競合KW' },
              { key: 'trends', label: 'トレンド' },
            ] as { key: TabKey; label: string }[]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'text-[#002C93] border-[#002C93]'
                    : 'text-[#64748B] border-transparent hover:text-[#1A1A2E]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="キーワード・メモを検索..."
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#E2E8F0] text-sm text-[#1A1A2E] bg-white focus:outline-none focus:ring-2 focus:ring-[#002C93]/20 focus:border-[#002C93]"
            />
          </div>

          {/* Data table（table-fixed + 列幅% でビュー内に収め、横スクロール不要） */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
            <div className="w-full overflow-hidden">
              <table className="w-full table-fixed text-xs border-collapse">
                <colgroup>
                  {isOrganicTab ? (
                    <>
                      <col style={{ width: '18%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '5%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '18%' }} />
                      <col style={{ width: '6%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '16%' }} />
                    </>
                  ) : (
                    <>
                      <col style={{ width: '24%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '5%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '9%' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '17%' }} />
                    </>
                  )}
                </colgroup>
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                    <th className="text-left px-2 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                        キーワード
                        <ColumnHint text={AHREFS_COLUMN_HINTS.keyword} />
                      </span>
                    </th>
                    <th className="text-right px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                      <span className="inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                        Vol
                        <ColumnHint text={AHREFS_COLUMN_HINTS.volume} />
                      </span>
                    </th>
                    <th className="text-right px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                      <span className="inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                        KD
                        <ColumnHint text={AHREFS_COLUMN_HINTS.kd} />
                      </span>
                    </th>
                    <th className="text-right px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                      <span className="inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                        CPC
                        <ColumnHint text={AHREFS_COLUMN_HINTS.cpc} />
                      </span>
                    </th>
                    <th className="text-center px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                      <span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">
                        優先度
                        <ColumnHint text={isOrganicTab ? AHREFS_COLUMN_HINTS.priorityOrganic : AHREFS_COLUMN_HINTS.priorityKeywords} />
                      </span>
                    </th>
                    <th className="text-center px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                      <span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">
                        トレンド
                        <ColumnHint text={AHREFS_COLUMN_HINTS.trend} />
                      </span>
                    </th>
                    <th className="text-left px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                        メモ
                        <ColumnHint text={AHREFS_COLUMN_HINTS.memo} />
                      </span>
                    </th>
                    {isOrganicTab && (
                      <>
                        <th className="text-right px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                          <span className="inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                            順位
                            <ColumnHint text={AHREFS_COLUMN_HINTS.position} />
                          </span>
                        </th>
                        <th className="text-right px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                          <span className="inline-flex items-center justify-end gap-0.5 whitespace-nowrap">
                            流入
                            <ColumnHint text={AHREFS_COLUMN_HINTS.trafficChange} />
                          </span>
                        </th>
                      </>
                    )}
                    <th className="text-center px-1.5 py-2 font-semibold text-[#64748B] whitespace-nowrap">
                      <span className="inline-flex items-center justify-center gap-0.5 whitespace-nowrap">
                        アクション
                        <ColumnHint text={AHREFS_COLUMN_HINTS.action} />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.length === 0 ? (
                    <tr>
                      <td colSpan={isOrganicTab ? 10 : 8} className="px-4 py-12 text-center text-[#94A3B8]">
                        該当するキーワードがありません
                      </td>
                    </tr>
                  ) : (
                    displayed.map((row, i) => {
                      const kwKey = normalizeKeywordForArticleMatch(row.keyword)
                      const wpEntries = keywordWpMap.get(kwKey)
                      const kwLabel = keywordActionButtonLabel(wpEntries)
                      const memo = getKeywordMemo(activeTab, row.keyword)
                      return (
                      <tr key={`${row.keyword}-${i}`} className="border-b border-[#F1F5F9] hover:bg-[#FAFBFC] transition-colors">
                        <td className="px-2 py-2 font-medium text-[#1A1A2E] max-w-0">
                          <div className="truncate" title={row.keyword}>{row.keyword}</div>
                        </td>
                        <td className="px-1.5 py-2 text-right tabular-nums">{row.volume.toLocaleString()}</td>
                        <td className="px-1.5 py-2 text-right">
                          <span className="font-semibold tabular-nums" style={{ color: kdColor(row.kd) }}>{row.kd}</span>
                        </td>
                        <td className="px-1.5 py-2 text-right tabular-nums">¥{Math.round(row.cpc).toLocaleString()}</td>
                        <td className="px-1.5 py-2 text-center"><PriorityBadge level={row.priority} compact /></td>
                        <td className="px-1.5 py-2 text-center"><TrendBadge trend={row.trend} percent={row.trendPercent} /></td>
                        <td className="px-1.5 py-2 text-left align-top">
                          <textarea
                            value={memo}
                            onChange={e => handleMemoChange(activeTab, row.keyword, e.target.value)}
                            placeholder="メモを入力..."
                            rows={2}
                            className="w-full min-h-[44px] resize-y rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] leading-snug text-[#1A1A2E] placeholder-[#CBD5E1] focus:outline-none focus:ring-2 focus:ring-[#002C93]/20 focus:border-[#002C93]"
                          />
                        </td>
                        {isOrganicTab && (
                          <>
                            <td className="px-1.5 py-2 text-right tabular-nums">{row.position ?? '-'}</td>
                            <td className="px-1.5 py-2 text-right tabular-nums text-[11px]">
                              {row.trafficChange !== null ? (
                                <span className={row.trafficChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                                  {row.trafficChange >= 0 ? '+' : ''}{row.trafficChange}
                                </span>
                              ) : '-'}
                            </td>
                          </>
                        )}
                        <td className="px-1.5 py-2 text-center align-top">
                          <div className="flex flex-col items-center gap-1 min-w-0">
                            <button
                              type="button"
                              onClick={() => handleWriteArticle(row)}
                              className="inline-flex items-center justify-center px-2 py-1 rounded-md text-[11px] font-semibold text-white transition-colors hover:opacity-90 whitespace-nowrap"
                              style={{ backgroundColor: row.priority === 3 ? '#E67E22' : '#002C93' }}
                            >
                              記事作成
                            </button>
                            {kwLabel.line ? (
                              <span
                                className="text-[9px] text-[#64748B] leading-tight text-center w-full line-clamp-2 break-words"
                                title={kwLabel.tooltip}
                              >
                                {kwLabel.line}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )})
                  )}
                </tbody>
              </table>
            </div>

            {/* Load more */}
            {filtered.length > showCount && (
              <div className="px-4 py-3 border-t border-[#E2E8F0] text-center">
                <button
                  onClick={() => setShowCount(prev => prev + PAGE_SIZE)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#002C93] hover:underline"
                >
                  <ChevronDown size={16} />
                  さらに表示（残り {filtered.length - showCount}件）
                </button>
              </div>
            )}

            {/* Total count footer */}
            <div className="px-4 py-2.5 border-t border-[#E2E8F0] bg-[#F8FAFC] text-xs text-[#94A3B8]">
              {filtered.length === activeTotal
                ? `${activeTotal}件`
                : `${filtered.length}件 / ${activeTotal}件`
              }
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------- Sub-components ----------

function SummaryCard({ label, value, color, icon }: { label: string; value: number; color: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-[12px] px-4 py-3.5" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="flex items-center gap-2 text-xs font-medium mb-1" style={{ color }}>
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums" style={{ color }}>{value.toLocaleString()}</div>
    </div>
  )
}

function PriorityBadge({ level, compact }: { level: PriorityLevel; compact?: boolean }) {
  const config = {
    3: { label: '★★★', bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
    2: { label: '★★', bg: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
    1: { label: '★', bg: '#F9FAFB', text: '#6B7280', border: '#E5E7EB' },
    0: { label: '−', bg: '#F9FAFB', text: '#D1D5DB', border: '#F3F4F6' },
  }[level]

  return (
    <span
      className={`inline-block rounded font-semibold border ${compact ? 'px-1 py-0.5 text-[10px] leading-none' : 'px-2 py-0.5 text-xs'}`}
      style={{ backgroundColor: config.bg, color: config.text, borderColor: config.border }}
    >
      {config.label}
    </span>
  )
}

function TrendBadge({ trend, percent }: { trend: 'up' | 'down' | 'stable'; percent: number }) {
  if (trend === 'up') return (
    <span className="inline-flex items-center justify-center gap-0.5 text-[10px] font-medium text-green-600 whitespace-nowrap">
      <TrendingUp size={11} className="shrink-0" /> +{percent}%
    </span>
  )
  if (trend === 'down') return (
    <span className="inline-flex items-center justify-center gap-0.5 text-[10px] font-medium text-red-500 whitespace-nowrap">
      <TrendingDown size={11} className="shrink-0" /> {percent}%
    </span>
  )
  return <span className="text-[10px] text-[#CBD5E1]">—</span>
}

function kdColor(kd: number): string {
  if (kd <= 30) return '#16a34a'
  if (kd <= 60) return '#ca8a04'
  return '#dc2626'
}
