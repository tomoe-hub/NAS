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
import { fetchArticleSummaries } from '@/lib/articleStorage'
import {
  buildKeywordWpEntriesByKeyword,
  keywordActionButtonLabel,
  normalizeKeywordForArticleMatch,
} from '@/lib/keywordPublishIndex'
import { ColumnHint } from '@/components/ui/ColumnHint'
import { Upload, X, Search, TrendingUp, TrendingDown, BarChart3, ChevronDown, ChevronUp, ChevronsUpDown, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { loadMemos, saveMemos, migrateLocalStorageToS3 } from '@/lib/keywordMemoStorage'
import { buildKwPrompt } from '@/lib/kwPromptBuilder'

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

/**
 * インポート履歴バッジ（CSV/APIの取り込み履歴一覧）をUIに表示するか。
 * データ自体（S3のインデックス）は表示OFFでも引き続き蓄積・利用され、削除機能もコードは残す。
 * 見栄えが悪いため、現在は非表示にしている。
 */
const SHOW_DATASET_HISTORY_BADGES = false

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
  const [dateSort, setDateSort] = useState<'desc' | 'asc' | null>(null)
  const [showCount, setShowCount] = useState(PAGE_SIZE)
  const [error, setError] = useState<string | null>(null)
  const [savedArticles, setSavedArticles] = useState<Awaited<ReturnType<typeof fetchArticleSummaries>>>([])
  const [keywordMemos, setKeywordMemos] = useState<Record<string, string>>({})
  const [apiFetching, setApiFetching] = useState(false)
  const [apiStatus, setApiStatus] = useState<{ configured: boolean; domain: string | null; hasApiKey: boolean } | null>(null)
  const [apiToast, setApiToast] = useState<{ msg: string; isError: boolean } | null>(null)

  const refreshSavedArticles = useCallback(async () => {
    setSavedArticles(await fetchArticleSummaries())
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

  // API 設定状態を取得
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/ahrefs/fetch')
        if (res.ok) setApiStatus(await res.json())
      } catch { /* silent */ }
    })()
  }, [])

  const handleApiFetch = useCallback(async () => {
    if (apiFetching) return
    setApiFetching(true)
    setApiToast(null)
    try {
      const res = await fetch('/api/ahrefs/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json() as {
        organic?:  { rowCount?: number; fileName?: string }
        keywords?: { rowCount?: number; fileName?: string }
        keError?:  string
        error?:    string
        usage?:    Record<string, number> | null
        // 旧フォーマット後方互換
        rowCount?: number
        fileName?: string
      }
      if (!res.ok || data.error) throw new Error(data.error ?? '取得に失敗しました')

      // 新フォーマット（organic + keywords）または旧フォーマット（rowCount）に対応
      const organicCount  = data.organic?.rowCount  ?? data.rowCount ?? 0
      const keywordsCount = data.keywords?.rowCount ?? 0

      let usageMsg = ''
      if (data.usage) {
        const used  = data.usage.units_used_this_month ?? data.usage.used
        const total = data.usage.units_limit_per_month ?? data.usage.limit
        if (typeof used === 'number' && typeof total === 'number') {
          usageMsg = `（今月 ${used.toLocaleString()} / ${total.toLocaleString()} units使用）`
        }
      }

      let msg = `更新完了：競合KW ${organicCount} 件`
      if (keywordsCount > 0) {
        msg += `・狙い目KW ${keywordsCount} 件`
      } else if (data.keError) {
        msg += `　※狙い目KW: ${data.keError}`
      }
      msg += usageMsg

      setApiToast({ msg, isError: false })
      await fetchData()
    } catch (e) {
      setApiToast({ msg: `エラー: ${e instanceof Error ? e.message : '取得に失敗しました'}`, isError: true })
    } finally {
      setApiFetching(false)
      setTimeout(() => setApiToast(null), 8000)
    }
  }, [apiFetching, fetchData])

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

  const formatDatasetDate = (iso: string) => {
    try { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}` } catch { return '' }
  }
  const tagRows = (d: AhrefsDataset) => {
    const dt = formatDatasetDate(d.uploadedAt)
    return d.keywords.map(row => ({ ...row, datasetDate: dt, datasetDateRaw: d.uploadedAt }))
  }

  const kwDatasets = useMemo(() => datasets.filter(d => d.type === 'keywords'), [datasets])
  const organicDatasets = useMemo(() => datasets.filter(d => d.type === 'organic'), [datasets])
  const allKeywords = useMemo(() => datasets.flatMap(tagRows), [datasets])

  const opportunityScored = useMemo(
    () => mergeAndAnalyze(kwDatasets.map(d => tagRows(d))),
    [kwDatasets],
  )
  const organicScored = useMemo(
    () => mergeAndAnalyzeOrganic(organicDatasets.map(d => tagRows(d))),
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

  const sorted = useMemo(() => {
    if (!dateSort) return filtered
    const dir = dateSort === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = a.datasetDateRaw ? new Date(a.datasetDateRaw).getTime() : 0
      const bv = b.datasetDateRaw ? new Date(b.datasetDateRaw).getTime() : 0
      return (av - bv) * dir
    })
  }, [filtered, dateSort])

  const toggleDateSort = useCallback(() => {
    setDateSort(prev => (prev === 'desc' ? 'asc' : 'desc'))
    setShowCount(PAGE_SIZE)
  }, [])

  const displayed = sorted.slice(0, showCount)

  // Stats from activeData
  const activeTotal = activeData.length
  const p3Count = activeData.filter(k => k.priority === 3).length
  const p2Count = activeData.filter(k => k.priority === 2).length
  const trendUpCount = activeData.filter(k => k.trend === 'up').length

  const isOrganicTab = activeTab === 'organic'

  // ----- Auto-prompt generation (NTS) -----

  const generateAutoPrompt = useCallback((row: ScoredKeyword): string => {
    const priorityLabel = row.priority === 3 ? '★★★即攻め' : row.priority === 2 ? '★★有望' : row.priority === 1 ? '★余力' : '対象外'
    return buildKwPrompt({
      keyword: row.keyword,
      volume: row.volume,
      kd: row.kd,
      cpc: row.cpc,
      trend: row.trend,
      trendPercent: row.trendPercent,
      detectedCategory: row.detectedCategory,
      priorityLabel,
      score: row.score,
    })
  }, [])

  const handleWriteArticle = useCallback((row: ScoredKeyword) => {
    const params = new URLSearchParams({
      kwTarget: row.keyword,
      kwPrompt: generateAutoPrompt(row),
      kwAuto: '1',
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

      {/* API トースト */}
      {apiToast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-[12px] text-sm font-semibold text-white shadow-lg"
          style={{
            background: apiToast.isError
              ? 'linear-gradient(135deg, #e53e4f, #b91c1c)'
              : 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
            boxShadow: apiToast.isError ? '0 8px 24px rgba(229,62,79,0.35)' : '0 8px 24px rgba(18,103,242,0.35)',
          }}
        >
          <RefreshCw size={14} />
          {apiToast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>KW分析ダッシュボード</h1>
          <p className="text-sm mt-1 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            Ahrefs CSVをインポートして、狙い目キーワードを分析
            {apiStatus && (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                style={apiStatus.configured
                  ? { color: '#065f46', background: '#ecfdf5', border: '1px solid #6ee7b7' }
                  : { color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d' }}
              >
                {apiStatus.configured
                  ? <><Wifi size={10} /> API接続済み ({apiStatus.domain})</>
                  : <><WifiOff size={10} /> API未設定</>}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
          {/* Ahrefs API 自動取得ボタン */}
          {apiStatus?.configured && (
            <button
              onClick={handleApiFetch}
              disabled={apiFetching}
              title={`${apiStatus.domain ?? ''} のオーガニックキーワードを Ahrefs API から取得`}
              className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-[10px] text-sm font-semibold transition-all hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                color: 'var(--primary)',
                background: 'rgba(18,103,242,0.07)',
                border: '1px solid rgba(18,103,242,0.22)',
                boxShadow: '0 1px 3px rgba(18,103,242,0.06)',
              }}
            >
              <RefreshCw size={15} className={apiFetching ? 'animate-spin' : ''} />
              {apiFetching ? '取得中...' : 'APIから今すぐ更新'}
            </button>
          )}
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

      {/* Dataset badges（インポート履歴。見栄えの都合でUI非表示。データ・削除機能はそのまま維持） */}
      {SHOW_DATASET_HISTORY_BADGES && index.length > 0 && (
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

          {/* Data table */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] overflow-hidden">
            <div className="w-full overflow-x-auto">
              <table className="w-full text-xs border-collapse" style={{ minWidth: isOrganicTab ? '1050px' : '900px' }}>
                <colgroup>
                  {isOrganicTab ? (
                    <>
                      <col style={{ width: '17%' }} />
                      <col style={{ width: '4%' }} />
                      <col style={{ width: '6%' }} />
                      <col style={{ width: '4%' }} />
                      <col style={{ width: '5%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '16%' }} />
                      <col style={{ width: '5%' }} />
                      <col style={{ width: '6%' }} />
                      <col style={{ width: '14%' }} />
                    </>
                  ) : (
                    <>
                      <col style={{ width: '22%' }} />
                      <col style={{ width: '4%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '5%' }} />
                      <col style={{ width: '7%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '8%' }} />
                      <col style={{ width: '20%' }} />
                      <col style={{ width: '14%' }} />
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
                    <th className="text-center px-1 py-2 font-semibold text-[#94A3B8] whitespace-nowrap text-[10px]">
                      <button
                        type="button"
                        onClick={toggleDateSort}
                        title="取得日でソート（クリックで昇順・降順を切り替え）"
                        className={`inline-flex items-center justify-center gap-0.5 whitespace-nowrap transition-colors hover:text-[#002C93] ${dateSort ? 'text-[#002C93]' : ''}`}
                      >
                        取得日
                        {dateSort === 'desc' ? (
                          <ChevronDown size={11} className="shrink-0" />
                        ) : dateSort === 'asc' ? (
                          <ChevronUp size={11} className="shrink-0" />
                        ) : (
                          <ChevronsUpDown size={11} className="shrink-0 opacity-50" />
                        )}
                      </button>
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
                      <td colSpan={isOrganicTab ? 11 : 9} className="px-4 py-12 text-center text-[#94A3B8]">
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
                        <td className="px-1 py-2 text-center text-[10px] text-[#94A3B8] tabular-nums whitespace-nowrap">{row.datasetDate || ''}</td>
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
