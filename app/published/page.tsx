'use client'

import SectionTabs from '@/components/navigation/SectionTabs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SavedArticle } from '@/lib/types'
import {
  fetchArticleSummaries,
  readSummariesCache,
  saveArticle,
  deleteArticle,
  getArticleById,
} from '@/lib/articleStorage'
import { applyInternalLinksToText } from '@/lib/internalLinks'
import { setSessionPreviewImage } from '@/lib/sessionPreviewImage'
import {
  FileText,
  ExternalLink,
  Copy,
  Trash2,
  Filter,
  Eye,
  FileDigit,
  Calendar,
  ChevronDown,
  ChevronUp,
  Tag,
} from 'lucide-react'
import {
  ARTICLE_CARD_PAGE_SIZE,
  formatCreatedDots,
  buildArticleExcerpt,
} from '@/lib/articleCardUtils'

type SortKey = 'dateDesc' | 'dateAsc' | 'titleAsc'

export default function PublishedArticlesPage() {
  const router = useRouter()
  const [articles, setArticles] = useState<SavedArticle[]>([])
  const [mounted, setMounted] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('dateDesc')
  const [visibleCount, setVisibleCount] = useState(ARTICLE_CARD_PAGE_SIZE)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<SavedArticle | null>(null)

  const loadArticles = async () => {
    const all = await fetchArticleSummaries()
    setArticles(all.filter(article => article.status === 'published'))
  }

  useEffect(() => {
    // キャッシュがあれば即描画し、裏で最新を再取得（SWRパターン）
    const cached = readSummariesCache()
    if (cached) {
      setArticles(cached.filter(article => article.status === 'published'))
      setMounted(true)
    }
    loadArticles().then(() => setMounted(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setVisibleCount(ARTICLE_CARD_PAGE_SIZE)
  }, [articles, searchQuery, sortKey])

  const handleDuplicateToSaved = async (summary: SavedArticle) => {
    // サマリーには本文がないため、複製時はフルデータを取得する
    const article = (await getArticleById(summary.id)) ?? summary
    const newArticle: SavedArticle = {
      ...article,
      id: `copy-${Date.now()}`,
      wordpressUrl: undefined,
      wordpressPostStatus: undefined,
      wordpressPublishedAt: undefined,
      status: 'draft',
      createdAt: new Date().toISOString(),
      scheduledDate: undefined,
      imageUrl: '',
    }
    try {
      await saveArticle(newArticle)
      setCopiedId(article.id)
      setTimeout(() => setCopiedId(null), 2000)
      await loadArticles()
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存に失敗しました')
    }
  }

  const handleDelete = (article: SavedArticle) => {
    setConfirmTarget(article)
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
      params.set('source', 'published')
      router.push(`/preview?${params.toString()}`)
    },
    [router]
  )

  const filteredAndSorted = useMemo(() => {
    let list = [...articles]

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(a => {
        const title = (a.refinedTitle || a.title || '').toLowerCase()
        const kw = (a.targetKeyword || '').toLowerCase()
        return title.includes(q) || kw.includes(q)
      })
    }

    list.sort((a, b) => {
      if (sortKey === 'titleAsc') {
        return (a.refinedTitle || a.title).localeCompare(b.refinedTitle || b.title, 'ja')
      }
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return sortKey === 'dateAsc' ? ta - tb : tb - ta
    })
    return list
  }, [articles, searchQuery, sortKey])

  const visibleArticles = useMemo(
    () => filteredAndSorted.slice(0, visibleCount),
    [filteredAndSorted, visibleCount]
  )

  const hasMore = visibleCount < filteredAndSorted.length

  if (!mounted) return null

  return (
    <div className="w-full pt-6 pb-16 max-w-7xl mx-auto">
      <SectionTabs
        label="記事管理"
        tabs={[
          { href: '/articles', label: '保存済み記事' },
          { href: '/published', label: '投稿済み記事' },
        ]}
      />

      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>過去投稿済み記事一覧</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            投稿済みの記事を確認・複製できます。削除しても WordPress 上の公開記事は削除されません。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFilterOpen(v => !v)}
          className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-[10px] text-sm font-semibold self-start sm:self-auto transition-all duration-150 hover:bg-white"
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
      </div>

      {filterOpen && (
        <div
          className="rounded-[14px] p-5 mb-6 grid gap-4 sm:grid-cols-2"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
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
            <p className="font-semibold text-base" style={{ color: 'var(--ink)' }}>投稿済み記事はまだありません</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              記事を WordPress に投稿すると、ここに一覧表示されます
            </p>
          </div>
        </div>
      )}

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
          条件に一致する記事がありません。検索や並び替えを調整してください。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {visibleArticles.map(article => {
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
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-md)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)' }}
            >
              <div className="relative aspect-[16/10] overflow-hidden" style={{ background: '#e9f0fa' }}>
                {article.imageUrl ? (
                  <img src={article.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <FileText size={32} style={{ color: '#b0c0d8' }} />
                  </div>
                )}
                <span
                  className="nas-badge absolute top-2.5 left-2.5"
                  style={{ background: '#f0fdf4', color: '#065f46', border: '1px solid #6ee7b7' }}
                >
                  <span className="nas-badge-dot" style={{ background: '#0f9f6e' }} />
                  投稿済み
                </span>
              </div>

              <div className="p-4 flex flex-col flex-1 min-h-0">
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

                <h2 className="text-sm font-bold leading-snug line-clamp-2 mb-2 min-h-[2.5rem]" style={{ color: 'var(--ink)' }} title={title}>
                  {title}
                </h2>

                <p className="text-xs leading-relaxed line-clamp-3 flex-1 mb-3" style={{ color: 'var(--text-muted)' }}>
                  {buildArticleExcerpt(article)}
                </p>

                {article.targetKeyword ? (
                  <span
                    className="text-[10px] px-2.5 py-0.5 rounded-full mb-2 w-fit font-medium"
                    style={{ color: 'var(--primary)', background: 'rgba(18,103,242,0.07)', border: '1px solid rgba(18,103,242,0.18)' }}
                  >
                    KW: {article.targetKeyword}
                  </span>
                ) : null}

                <div className="mb-3 min-h-0">
                  <div className="flex items-center gap-1 text-[10px] font-semibold mb-1.5" style={{ color: 'var(--text-faint)' }}>
                    <Tag size={11} className="flex-shrink-0" aria-hidden />
                    投稿タグ
                  </div>
                  {article.wordpressTags && article.wordpressTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {article.wordpressTags.map((tag, i) => (
                        <span
                          key={`${tag}-${i}`}
                          className="text-[10px] px-2 py-0.5 rounded-[6px] max-w-full truncate"
                          style={{ color: 'var(--text-muted)', background: 'rgba(20,44,92,0.05)', border: '1px solid var(--border)' }}
                          title={tag}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>タグなし</p>
                  )}
                </div>

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
                      onClick={() => void handleDuplicateToSaved(article)}
                      className="p-2 rounded-[8px] transition-colors hover:bg-[rgba(18,103,242,0.07)]"
                      style={{ color: copiedId === article.id ? 'var(--success)' : 'var(--text-muted)' }}
                      aria-label={copiedId === article.id ? '複製しました' : '保存済みに複製'}
                      title={copiedId === article.id ? '複製しました' : '保存済みに複製'}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(article)}
                      className="p-2 rounded-[8px] transition-colors hover:bg-red-50"
                      style={{ color: 'var(--danger)' }}
                      aria-label="一覧から削除"
                      title="一覧から削除"
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

      {articles.length > 0 && hasMore && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount(c => c + ARTICLE_CARD_PAGE_SIZE)}
            className="inline-flex items-center gap-2 min-h-[44px] px-8 rounded-[12px] text-sm font-semibold transition-all hover:bg-white"
            style={{ color: 'var(--text-muted)', border: '1.5px dashed var(--border)', background: 'rgba(255,255,255,0.50)' }}
          >
            さらに表示（あと {filteredAndSorted.length - visibleCount} 件）
          </button>
        </div>
      )}

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(10,20,50,0.45)', backdropFilter: 'blur(4px)' }}>
          <div
            className="w-full max-w-md rounded-[18px] p-6 space-y-4 mx-4"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)' }}
          >
            <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
              記事を一覧から削除しますか？
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)', whiteSpace: 'pre-line' }}>
              {`「${(confirmTarget.refinedTitle || confirmTarget.title).slice(0, 30)}…」を一覧から削除しますか？\nWordPress上の公開記事は削除されません。`}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="min-h-[40px] px-4 rounded-[9px] text-sm font-medium transition-colors hover:bg-gray-100"
                style={{ background: 'rgba(20,44,92,0.07)', color: 'var(--ink)' }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={async () => {
                  await deleteArticle(confirmTarget.id)
                  setConfirmTarget(null)
                  await loadArticles()
                }}
                className="flex items-center gap-2 min-h-[40px] px-4 rounded-[9px] text-sm font-semibold text-white transition-all hover:brightness-110"
                style={{ background: 'var(--danger)', boxShadow: '0 4px 12px rgba(229,62,79,0.28)' }}
              >
                <Trash2 size={14} />
                一覧から削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
