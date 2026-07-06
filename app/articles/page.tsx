'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SavedArticle } from '@/lib/types'
import {
  fetchArticleSummaries,
  readSummariesCache,
  deleteArticle,
  saveArticle,
  getArticleById,
} from '@/lib/articleStorage'
import { applyInternalLinksToText } from '@/lib/internalLinks'
import { setSessionPreviewImage } from '@/lib/sessionPreviewImage'
import {
  FileText,
  Trash2,
  Calendar,
  ExternalLink,
  Plus,
  Filter,
  Eye,
  Pencil,
  FileDigit,
  ChevronDown,
  ChevronUp,
  Cpu,
} from 'lucide-react'
import {
  ARTICLE_CARD_PAGE_SIZE,
  formatCreatedDots,
  buildArticleExcerpt,
} from '@/lib/articleCardUtils'

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: '下書き', color: '#F59E0B', bg: '#FFFBEB' },
  ready: { label: '投稿準備完了', color: '#16A34A', bg: '#F0FDF4' },
  published: { label: '投稿済み', color: '#64748B', bg: '#F8FAFC' },
}

type SortKey = 'dateDesc' | 'dateAsc' | 'titleAsc'
type StatusFilter = 'all' | 'draft' | 'ready'

export default function ArticlesPage() {
  const router = useRouter()
  const [articles, setArticles] = useState<SavedArticle[]>([])
  const [mounted, setMounted] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('dateDesc')
  const [visibleCount, setVisibleCount] = useState(ARTICLE_CARD_PAGE_SIZE)
  const [vectorizing, setVectorizing] = useState(false)
  const [vectorToast, setVectorToast] = useState<string | null>(null)

  const reloadArticles = async () => {
    const all = await fetchArticleSummaries()
    setArticles(all.filter(article => article.status !== 'published'))
  }

  const handleVectorize = async () => {
    if (vectorizing) return
    setVectorizing(true)
    setVectorToast(null)
    try {
      const res = await fetch('/api/articles/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'all', limit: 10 }),
      })
      const data = await res.json() as { done?: number; skipped?: number; failed?: number; remaining?: number; error?: string }
      if (data.error) throw new Error(data.error)
      const remaining = data.remaining ?? 0
      const msg = `ベクトル化完了：新規 ${data.done ?? 0} 件${remaining > 0 ? `（残り約 ${remaining} 件 — もう一度押してください）` : '（全件処理済み）'}`
      setVectorToast(msg)
    } catch (e) {
      setVectorToast(`エラー: ${e instanceof Error ? e.message : 'ベクトル化に失敗しました'}`)
    } finally {
      setVectorizing(false)
      setTimeout(() => setVectorToast(null), 6000)
    }
  }

  useEffect(() => {
    // キャッシュがあれば即描画し、裏で最新を再取得（SWRパターン）
    const cached = readSummariesCache()
    if (cached) {
      setArticles(cached.filter(article => article.status !== 'published'))
      setMounted(true)
    }
    reloadArticles().then(() => setMounted(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setVisibleCount(ARTICLE_CARD_PAGE_SIZE)
  }, [articles, statusFilter, searchQuery, sortKey])

  const handleDelete = async (id: string) => {
    if (!confirm('この記事を削除しますか？')) return
    await deleteArticle(id)
    await reloadArticles()
  }

  const handleScheduleChange = async (id: string, date: string) => {
    // フルデータを取得してから保存（サマリーを保存すると本文が消えるため）
    const article = await getArticleById(id)
    if (article) {
      article.scheduledDate = date
      await saveArticle(article)
      await reloadArticles()
    }
  }

  const handlePublish = (article: SavedArticle) => {
    router.push(`/editor?articleId=${article.id}&step=5`)
  }

  const handlePreview = useCallback(
    async (summary: SavedArticle) => {
      // 一覧はサマリー（本文なし）のため、プレビュー時にフルデータを取得
      const article = (await getArticleById(summary.id)) ?? summary
      const content = applyInternalLinksToText(
        article.refinedContent || article.originalContent || '',
        []
      )
      sessionStorage.setItem('preview_content', content)
      await setSessionPreviewImage(article.imageUrl || null)
      const params = new URLSearchParams({
        title: (article.refinedTitle || article.title || '').trim(),
        category: 'お役立ち情報',
        date: formatCreatedDots(article.createdAt),
      })
      params.set('articleId', article.id)
      if (article.imageUrl && !article.imageUrl.startsWith('data:')) {
        params.set('imageUrl', article.imageUrl)
      }
      router.push(`/preview?${params.toString()}`)
    },
    [router]
  )

  const filteredAndSorted = useMemo(() => {
    let list = articles

    if (statusFilter !== 'all') {
      list = list.filter(a => a.status === statusFilter)
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(a => {
        const title = (a.refinedTitle || a.title || '').toLowerCase()
        const kw = (a.targetKeyword || '').toLowerCase()
        return title.includes(q) || kw.includes(q)
      })
    }

    const sorted = [...list]
    sorted.sort((a, b) => {
      if (sortKey === 'titleAsc') {
        return (a.refinedTitle || a.title).localeCompare(b.refinedTitle || b.title, 'ja')
      }
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return sortKey === 'dateAsc' ? ta - tb : tb - ta
    })
    return sorted
  }, [articles, statusFilter, searchQuery, sortKey])

  const visibleArticles = useMemo(
    () => filteredAndSorted.slice(0, visibleCount),
    [filteredAndSorted, visibleCount]
  )

  const hasMore = visibleCount < filteredAndSorted.length

  if (!mounted) return null

  const vectorToastIsError = vectorToast?.startsWith('エラー')

  const statusDot: Record<string, { dot: string; text: string; bg: string; border: string }> = {
    draft:     { dot: '#f59e0b', text: '#92400e', bg: '#fffbeb', border: '#fcd34d' },
    ready:     { dot: '#0f9f6e', text: '#065f46', bg: '#ecfdf5', border: '#6ee7b7' },
    published: { dot: '#64748b', text: '#334155', bg: '#f8fafc', border: '#cbd5e1' },
  }

  return (
    <div className="w-full pt-6 pb-16 max-w-7xl mx-auto">

      {/* ── ベクトル化トースト ── */}
      {vectorToast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-[12px] text-sm font-semibold text-white shadow-lg transition-all duration-300"
          style={{
            background: vectorToastIsError
              ? 'linear-gradient(135deg, #e53e4f, #b91c1c)'
              : 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
            boxShadow: vectorToastIsError
              ? '0 8px 24px rgba(229,62,79,0.35)'
              : '0 8px 24px rgba(18,103,242,0.35)',
          }}
        >
          <Cpu size={15} />
          {vectorToast}
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>保存済み記事一覧</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            作成済み記事の確認・修正・投稿予定日の設定ができます
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterOpen(v => !v)}
            className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-[10px] text-sm font-semibold transition-all duration-150 hover:bg-white"
            style={{
              color: 'var(--text-muted)',
              background: filterOpen ? 'white' : 'rgba(255,255,255,0.60)',
              border: '1px solid var(--border)',
              boxShadow: '0 1px 3px rgba(20,44,92,0.06)',
            }}
          >
            <Filter size={15} />
            フィルター
            {filterOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button
            type="button"
            onClick={handleVectorize}
            disabled={vectorizing}
            title="過去記事をGemini Embeddingでベクトル化します。10件ずつ処理されます。"
            className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-[10px] text-sm font-semibold transition-all duration-150 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              color: 'var(--primary)',
              background: 'rgba(18,103,242,0.06)',
              border: '1px solid rgba(18,103,242,0.22)',
              boxShadow: '0 1px 3px rgba(18,103,242,0.06)',
            }}
          >
            <Cpu size={15} className={vectorizing ? 'animate-pulse' : ''} />
            {vectorizing ? 'ベクトル化中...' : '過去記事をベクトル化'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/editor')}
            className="inline-flex items-center gap-2 min-h-[40px] px-5 rounded-[10px] text-sm font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
              boxShadow: '0 4px 14px rgba(18,103,242,0.35), inset 0 1px 0 rgba(255,255,255,0.22)',
            }}
          >
            <Plus size={15} />
            新規作成
          </button>
        </div>
      </div>

      {/* ── Filter Panel ── */}
      {filterOpen && (
        <div
          className="rounded-[14px] p-5 mb-6 grid gap-4 sm:grid-cols-3"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>ステータス</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full px-3 py-2 rounded-[9px] text-sm"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'white' }}
            >
              <option value="all">すべて</option>
              <option value="draft">下書き</option>
              <option value="ready">投稿準備完了</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>タイトル・KW で検索</label>
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="キーワードを入力…"
              className="w-full px-3 py-2 rounded-[9px] text-sm"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'white' }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-muted)' }}>並び替え</label>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="w-full px-3 py-2 rounded-[9px] text-sm"
              style={{ border: '1px solid var(--border)', color: 'var(--ink)', background: 'white' }}
            >
              <option value="dateDesc">作成日（新しい順）</option>
              <option value="dateAsc">作成日（古い順）</option>
              <option value="titleAsc">タイトル（あいうえお順）</option>
            </select>
          </div>
        </div>
      )}

      {/* ── Empty ── */}
      {articles.length === 0 && (
        <div
          className="rounded-[18px] py-20 flex flex-col items-center gap-4 text-center"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(18,103,242,0.07)', border: '1px solid rgba(18,103,242,0.12)' }}
          >
            <FileText size={28} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <p className="font-semibold text-base" style={{ color: 'var(--ink)' }}>保存済み記事はまだありません</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              記事を作成して下書き保存すると、ここに一覧表示されます
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/editor')}
            className="mt-2 min-h-[44px] px-6 rounded-[11px] text-sm font-semibold text-white transition-all hover:brightness-110"
            style={{
              background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
              boxShadow: '0 4px 14px rgba(18,103,242,0.35)',
            }}
          >
            最初の記事を作成する
          </button>
        </div>
      )}

      {/* ── Count ── */}
      {articles.length > 0 && (
        <p className="text-xs font-medium mb-4" style={{ color: 'var(--text-faint)' }}>
          {filteredAndSorted.length} 件
          {filteredAndSorted.length !== articles.length && `（全 ${articles.length} 件中）`}
        </p>
      )}

      {articles.length > 0 && filteredAndSorted.length === 0 && (
        <div
          className="rounded-[14px] p-12 text-center text-sm"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          条件に一致する記事がありません。フィルターを調整してください。
        </div>
      )}

      {/* ── Card Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {visibleArticles.map(article => {
          const st = STATUS_LABEL[article.status]
          const sd = statusDot[article.status] ?? statusDot.draft
          const title = article.refinedTitle || article.title
          return (
            <article
              key={article.id}
              className="group flex flex-col rounded-[16px] overflow-hidden transition-all duration-200 hover:-translate-y-0.5"
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-sm)',
              }}
              onMouseEnter={e => {
                ;(e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)'
              }}
              onMouseLeave={e => {
                ;(e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'
              }}
            >
              {/* Image */}
              <div className="relative aspect-[16/10] overflow-hidden" style={{ background: '#e9f0fa' }}>
                {article.imageUrl ? (
                  <img src={article.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileText size={32} style={{ color: '#b0c0d8' }} />
                  </div>
                )}
                {/* Status badge */}
                <span
                  className="nas-badge absolute top-2.5 left-2.5"
                  style={{ background: sd.bg, color: sd.text, border: `1px solid ${sd.border}` }}
                >
                  <span className="nas-badge-dot" style={{ background: sd.dot }} />
                  {st.label}
                </span>
              </div>

              <div className="p-4 flex flex-col flex-1 min-h-0">
                {/* Meta */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] mb-2" style={{ color: 'var(--text-faint)' }}>
                  <span className="inline-flex items-center gap-1">
                    <Calendar size={12} />
                    {formatCreatedDots(article.createdAt)}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1">
                    <FileDigit size={12} />
                    {article.wordCount.toLocaleString()}文字
                  </span>
                </div>

                {/* Title */}
                <h2 className="text-sm font-bold leading-snug line-clamp-2 mb-2 min-h-[2.5rem]" style={{ color: 'var(--ink)' }} title={title}>
                  {title}
                </h2>

                {/* Excerpt */}
                <p className="text-xs leading-relaxed line-clamp-3 flex-1 mb-3" style={{ color: 'var(--text-muted)' }}>
                  {buildArticleExcerpt(article)}
                </p>

                {/* KW */}
                {article.targetKeyword ? (
                  <span
                    className="text-[10px] px-2.5 py-0.5 rounded-full mb-3 w-fit font-medium"
                    style={{ color: 'var(--primary)', background: 'rgba(18,103,242,0.07)', border: '1px solid rgba(18,103,242,0.18)' }}
                  >
                    KW: {article.targetKeyword}
                  </span>
                ) : (
                  <div className="mb-3" />
                )}

                {/* Schedule date input */}
                <div className="flex items-center gap-2 mb-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <Calendar size={14} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                  <input
                    type="date"
                    value={article.scheduledDate ?? ''}
                    onChange={e => handleScheduleChange(article.id, e.target.value)}
                    className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-[8px]"
                    style={{
                      fontFamily: 'DM Mono, monospace',
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      background: 'white',
                    }}
                    aria-label="投稿予定日"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between gap-2 mt-auto pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => void handlePreview(article)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold min-h-[36px] px-2 rounded-[8px] transition-colors hover:bg-[rgba(18,103,242,0.06)]"
                    style={{ color: 'var(--primary)' }}
                  >
                    <Eye size={14} />
                    プレビュー
                  </button>
                  <div className="flex items-center gap-1">
                    {article.wordpressUrl && (
                      <a
                        href={article.wordpressUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-[8px] transition-colors hover:bg-[rgba(18,103,242,0.07)]"
                        style={{ color: 'var(--text-muted)' }}
                        aria-label="WordPressで開く"
                      >
                        <ExternalLink size={15} />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => handlePublish(article)}
                      className="p-2 rounded-[8px] transition-colors hover:bg-[rgba(18,103,242,0.07)]"
                      style={{ color: 'var(--text-muted)' }}
                      aria-label="修正する"
                      title="修正する"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(article.id)}
                      className="p-2 rounded-[8px] transition-colors hover:bg-red-50"
                      style={{ color: 'var(--danger)' }}
                      aria-label="この記事を削除する"
                      title="削除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {/* Load more */}
      {articles.length > 0 && hasMore && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount(c => c + ARTICLE_CARD_PAGE_SIZE)}
            className="inline-flex items-center gap-2 min-h-[44px] px-8 rounded-[12px] text-sm font-semibold transition-all hover:bg-white"
            style={{
              color: 'var(--text-muted)',
              border: '1.5px dashed var(--border)',
              background: 'rgba(255,255,255,0.50)',
            }}
          >
            さらに表示（あと {filteredAndSorted.length - visibleCount} 件）
          </button>
        </div>
      )}
    </div>
  )
}
