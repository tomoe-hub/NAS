'use client'
import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { SavedArticle } from '@/lib/types'
import { resolveCanonicalPostSlug } from '@/lib/slugNormalize'
import {
  fetchArticleSummaries,
  readSummariesCache,
  saveArticle,
  getArticleById,
} from '@/lib/articleStorage'
import {
  ChevronLeft,
  ChevronRight,
  Send,
  Pencil,
  FileText,
  CalendarDays,
  Trash2,
  Clock,
  Loader2,
  List,
} from 'lucide-react'
import { snapScheduledTimeToQuarterHour } from '@/lib/scheduledTimeQuarterHour'

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}
function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay()
}
function toYMD(date: Date) {
  return date.toISOString().slice(0, 10)
}
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/** カレンダー／一覧／カード共通の「投稿スケジュール段階」 */
function getScheduleStage(article: SavedArticle): {
  key: string
  label: string
  color: string
  bg: string
} {
  if (!article.scheduledDate) {
    return { key: 'unscheduled', label: '投稿日未設定', color: '#94A3B8', bg: '#F1F5F9' }
  }
  const hasTime = Boolean(article.scheduledTime?.trim())
  if (!hasTime) {
    return { key: 'date_only', label: '投稿日のみ確定', color: '#0369A1', bg: '#E0F2FE' }
  }
  if (article.wordpressPostStatus === 'future') {
    return { key: 'wp_future', label: 'WP予約投稿済み', color: '#6D28D9', bg: '#EDE9FE' }
  }
  if (article.wordpressPostStatus === 'publish') {
    return { key: 'wp_publish', label: 'WP公開済み', color: '#475569', bg: '#F8FAFC' }
  }
  if (article.wordpressUrl) {
    return { key: 'wp_sent', label: 'WordPress送信済み', color: '#64748B', bg: '#F1F5F9' }
  }
  return {
    key: 'datetime_ready',
    label: '公開日時まで設定（WP未送信）',
    color: '#15803D',
    bg: '#DCFCE7',
  }
}

function sortKeyForScheduled(a: SavedArticle): string {
  const d = a.scheduledDate ?? ''
  const t = a.scheduledTime?.trim() ? a.scheduledTime! : '99:99'
  return `${d}T${t}`
}

/** 予定日時が「いま」より後か（過去の予約・送信済みは一覧から除外） */
function getScheduledInstant(article: SavedArticle): number {
  const d = article.scheduledDate!
  if (article.scheduledTime?.trim()) {
    return new Date(`${d}T${article.scheduledTime.trim()}:00`).getTime()
  }
  const [y, mo, day] = d.split('-').map(Number)
  return new Date(y, mo - 1, day, 23, 59, 59, 999).getTime()
}

function isUpcomingScheduled(article: SavedArticle): boolean {
  if (!article.scheduledDate) return false
  return getScheduledInstant(article) > Date.now()
}

export default function SchedulePage() {
  const router = useRouter()
  const today = new Date()

  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState(toYMD(today))
  const [articles, setArticles] = useState<SavedArticle[]>([])
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<{ articleId: string; success: boolean; message: string } | null>(null)
  const [customSlugIds, setCustomSlugIds] = useState<Set<string>>(new Set())
  const [scheduleListThisMonthOnly, setScheduleListThisMonthOnly] = useState(true)

  useEffect(() => {
    // キャッシュがあれば即描画し、裏で最新を再取得（SWRパターン）
    const cached = readSummariesCache()
    if (cached) {
      setArticles(cached)
      setMounted(true)
    }
    fetchArticleSummaries().then(async all => {
      const toFix = all.filter(a => {
        if (!a.scheduledTime?.trim()) return false
        return snapScheduledTimeToQuarterHour(a.scheduledTime) !== a.scheduledTime.trim()
      })
      if (toFix.length) {
        // サマリーを直接保存すると本文が消えるため、必ずフルデータを取得してから保存
        await Promise.all(
          toFix.map(async s => {
            const full = await getArticleById(s.id)
            if (full) {
              await saveArticle({
                ...full,
                scheduledTime: snapScheduledTimeToQuarterHour(full.scheduledTime!),
              })
            }
          })
        )
        setArticles(await fetchArticleSummaries())
      } else {
        setArticles(all)
      }
      setMounted(true)
    })
  }, [])

  const articlesByDate = useMemo(() => {
    const map: Record<string, SavedArticle[]> = {}
    articles.forEach(a => {
      const d = a.scheduledDate
      if (d) {
        if (!map[d]) map[d] = []
        map[d].push(a)
      }
    })
    return map
  }, [articles])

  const scheduledArticlesSorted = useMemo(() => {
    const withDate = articles.filter(a => a.scheduledDate)
    return [...withDate].sort((a, b) => sortKeyForScheduled(a).localeCompare(sortKeyForScheduled(b)))
  }, [articles])

  const scheduleTableRows = useMemo(() => {
    const upcoming = scheduledArticlesSorted.filter(isUpcomingScheduled)
    if (!scheduleListThisMonthOnly) return upcoming
    const y = year
    const m = month + 1
    const prefix = `${y}-${String(m).padStart(2, '0')}`
    return upcoming.filter(a => a.scheduledDate?.startsWith(prefix))
  }, [scheduledArticlesSorted, scheduleListThisMonthOnly, year, month])

  const selectedArticles = articlesByDate[selectedDate] ?? []

  const prevMonth = () => {
    if (month === 0) {
      setYear(y => y - 1)
      setMonth(11)
    } else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) {
      setYear(y => y + 1)
      setMonth(0)
    } else setMonth(m => m + 1)
  }

  const daysInMonth = getDaysInMonth(year, month)
  const firstDayOfWeek = getFirstDayOfMonth(year, month)
  const calendarCells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (calendarCells.length % 7 !== 0) calendarCells.push(null)

  const handleScheduleChange = async (articleId: string, date: string) => {
    const a = await getArticleById(articleId)
    if (a) {
      a.scheduledDate = date
      await saveArticle(a)
      setArticles(await fetchArticleSummaries())
    }
  }

  const handleTimeChange = async (articleId: string, time: string) => {
    const normalized = snapScheduledTimeToQuarterHour(time)
    const a = await getArticleById(articleId)
    if (a) {
      a.scheduledTime = normalized
      await saveArticle(a)
      setArticles(await fetchArticleSummaries())
    }
  }

  const handleSlugChange = async (articleId: string, newSlug: string) => {
    const a = await getArticleById(articleId)
    if (a) {
      a.slug = newSlug
      await saveArticle(a)
      setArticles(await fetchArticleSummaries())
    }
  }

  const handleScheduledPublish = async (summary: SavedArticle) => {
    if (!summary.scheduledDate || !summary.scheduledTime) return
    setPublishingId(summary.id)
    setPublishResult(null)

    try {
      // 一覧はサマリー（本文なし）のため、投稿前にフルデータを取得
      const article = (await getArticleById(summary.id)) ?? summary
      const scheduledDate = `${article.scheduledDate}T${article.scheduledTime}:00`
      const content = article.refinedContent || article.originalContent || ''

      const res = await fetch('/api/wordpress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: article.refinedTitle || article.title,
          content,
          targetKeyword: article.targetKeyword,
          imageUrl: article.imageUrl,
          status: 'future',
          scheduledDate,
          slug: resolveCanonicalPostSlug(article.slug?.trim() ?? ''),
          wordpressTags: article.wordpressTags?.length ? article.wordpressTags : undefined,
        }),
      })

      const data = await res.json()

      if (res.ok && data.postId) {
        article.status = 'published'
        article.wordpressUrl = data.wordpressUrl
        if (typeof data.status === 'string' && data.status) {
          article.wordpressPostStatus = data.status
        }
        if (typeof data.dateGmt === 'string' && data.dateGmt.trim()) {
          article.wordpressPublishedAt = data.dateGmt.trim()
        }
        await saveArticle(article)
        setArticles(await fetchArticleSummaries())
        const dateObj = new Date(scheduledDate)
        const timeStr = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日 ${article.scheduledTime}`
        setPublishResult({ articleId: article.id, success: true, message: `予約投稿しました（${timeStr} 公開予定）` })
      } else {
        setPublishResult({ articleId: article.id, success: false, message: data.error || '予約投稿に失敗しました' })
      }
    } catch {
      setPublishResult({ articleId: summary.id, success: false, message: 'ネットワークエラーが発生しました' })
    } finally {
      setPublishingId(null)
    }
  }

  const handleDeleteConfirmed = async () => {
    if (!deleteTargetId) return
    const target = await getArticleById(deleteTargetId)
    if (target) {
      target.scheduledDate = undefined
      target.scheduledTime = undefined
      await saveArticle(target)
    }
    setArticles(await fetchArticleSummaries())
    setDeleteTargetId(null)
  }

  if (!mounted) return null

  const inputStyle = {
    border: '1px solid var(--border)',
    color: 'var(--text-muted)',
    fontFamily: 'DM Mono, monospace',
    background: 'white',
    borderRadius: '8px',
    padding: '3px 8px',
    fontSize: '12px',
  }

  return (
    <div className="w-full pt-6 pb-12">
      {/* Delete confirm dialog */}
      {deleteTargetId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(10,20,50,0.45)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-sm rounded-[18px] p-5 mx-4"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            <p className="text-sm font-semibold mb-4" style={{ color: 'var(--ink)' }}>
              予定日の設定を解除しますか？
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTargetId(null)}
                className="min-h-[38px] px-4 rounded-[9px] text-sm font-medium transition-colors hover:bg-gray-100"
                style={{ background: 'rgba(20,44,92,0.06)', color: 'var(--ink)' }}
              >
                いいえ
              </button>
              <button
                onClick={handleDeleteConfirmed}
                className="min-h-[38px] px-4 rounded-[9px] text-sm font-semibold text-white transition-all hover:brightness-110"
                style={{ background: 'var(--danger)', boxShadow: '0 4px 12px rgba(229,62,79,0.28)' }}
              >
                はい、解除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>投稿スケジュール</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          記事の投稿予定日を設定・管理できます
        </p>
      </div>

      {/* Schedule list table */}
      <div
        className="rounded-[14px] mb-6 overflow-hidden"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <List size={16} style={{ color: 'var(--primary)' }} />
            <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
              予定一覧（未来の投稿）
            </h2>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={scheduleListThisMonthOnly}
              onChange={e => setScheduleListThisMonthOnly(e.target.checked)}
              className="rounded"
            />
            <span>{year}年{MONTH_NAMES[month]}のみ表示</span>
          </label>
        </div>
        {scheduleTableRows.length === 0 ? (
          <p className="text-xs px-5 py-8 text-center" style={{ color: 'var(--text-faint)' }}>
            {scheduleListThisMonthOnly ? 'この月に、今後投稿予定の記事はありません' : '今後投稿予定の記事はありません'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr style={{ background: 'rgba(18,103,242,0.03)', color: 'var(--text-muted)' }}>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">予定日</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">時刻</th>
                  <th className="px-4 py-2.5 font-semibold min-w-[12rem]">タイトル</th>
                  <th className="px-4 py-2.5 font-semibold min-w-[7rem]">KW</th>
                  <th className="px-4 py-2.5 font-semibold min-w-[10rem]">タグ</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">段階</th>
                  <th className="px-4 py-2.5 font-semibold whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {scheduleTableRows.map(article => {
                  const stage = getScheduleStage(article)
                  const title = article.refinedTitle || article.title
                  return (
                    <tr key={article.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--ink)' }}>
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap align-top" style={{ color: 'var(--text-muted)' }}>
                        {article.scheduledDate}
                      </td>
                      <td className="px-4 py-2.5 font-mono whitespace-nowrap align-top" style={{ color: 'var(--text-muted)' }}>
                        {article.scheduledTime?.trim() ? article.scheduledTime : '—'}
                      </td>
                      <td className="px-4 py-2.5 align-top max-w-[20rem]">
                        <div className="line-clamp-2" title={title}>{title}</div>
                      </td>
                      <td className="px-4 py-2.5 align-top max-w-[10rem] truncate" style={{ color: 'var(--text-muted)' }} title={article.targetKeyword}>
                        {article.targetKeyword || '—'}
                      </td>
                      <td className="px-4 py-2.5 align-top max-w-[14rem]" title={article.wordpressTags?.length ? article.wordpressTags.join('、') : undefined}>
                        {article.wordpressTags && article.wordpressTags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {article.wordpressTags.map((tag, i) => (
                              <span
                                key={`${article.id}-tag-${i}-${tag}`}
                                className="text-[10px] px-1.5 py-0.5 rounded-[5px] max-w-[8rem] truncate inline-block align-middle"
                                style={{ color: 'var(--text-muted)', background: 'rgba(20,44,92,0.05)', border: '1px solid var(--border)' }}
                                title={tag}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-faint)' }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-nowrap">
                        <span
                          className="nas-badge"
                          style={{ color: stage.color, background: stage.bg }}
                        >
                          {stage.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 align-top whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            if (article.scheduledDate) setSelectedDate(article.scheduledDate)
                            setYear(parseInt(article.scheduledDate!.slice(0, 4), 10))
                            setMonth(parseInt(article.scheduledDate!.slice(5, 7), 10) - 1)
                          }}
                          className="text-xs font-semibold px-2 py-1 rounded-[7px] transition-colors hover:bg-[rgba(18,103,242,0.10)]"
                          style={{ color: 'var(--primary)', background: 'rgba(18,103,242,0.07)', border: '1px solid rgba(18,103,242,0.18)' }}
                        >
                          カレンダーで確認
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 2-pane layout: Calendar + Selected day */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Calendar pane */}
        <div
          className="flex-shrink-0 rounded-[16px] p-5 w-full lg:w-[340px]"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={prevMonth}
              className="p-1.5 rounded-[8px] transition-colors hover:bg-[rgba(18,103,242,0.07)]"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="font-bold text-sm" style={{ color: 'var(--ink)' }}>
              {year}年 {MONTH_NAMES[month]}
            </span>
            <button
              onClick={nextMonth}
              className="p-1.5 rounded-[8px] transition-colors hover:bg-[rgba(18,103,242,0.07)]"
              style={{ color: 'var(--text-muted)' }}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className="text-center text-xs py-1 font-semibold"
                style={{ color: i === 0 ? '#ef4444' : i === 6 ? 'var(--primary)' : 'var(--text-faint)' }}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-0.5">
            {calendarCells.map((day, idx) => {
              if (!day) return <div key={idx} />

              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const isToday = dateStr === toYMD(today)
              const isSelected = dateStr === selectedDate
              const dayArticles = articlesByDate[dateStr] ?? []
              const hasPublished = dayArticles.some(a => a.status === 'published')
              const hasReady = dayArticles.some(a => a.status === 'ready')
              const hasDraft = dayArticles.some(a => a.status === 'draft')
              const dotColor = hasPublished ? '#64748b' : hasReady ? '#0f9f6e' : hasDraft ? '#f59e0b' : null
              const dow = (firstDayOfWeek + day - 1) % 7

              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDate(dateStr)}
                  className="flex flex-col items-center justify-center rounded-[10px] py-1.5 transition-all duration-100"
                  style={{
                    background: isSelected
                      ? 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)'
                      : isToday
                        ? 'rgba(18,103,242,0.08)'
                        : 'transparent',
                    border: isToday && !isSelected ? '1.5px solid rgba(18,103,242,0.30)' : '1.5px solid transparent',
                  }}
                >
                  <span
                    className="text-sm font-medium"
                    style={{
                      color: isSelected
                        ? 'white'
                        : isToday
                          ? 'var(--primary)'
                          : dow === 0
                            ? '#ef4444'
                            : dow === 6
                              ? 'var(--primary)'
                              : 'var(--ink)',
                    }}
                  >
                    {day}
                  </span>
                  {dotColor && (
                    <div
                      className="w-1.5 h-1.5 rounded-full mt-0.5"
                      style={{ background: isSelected ? 'rgba(255,255,255,0.75)' : dotColor }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-4 pt-4 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
              ドットの意味
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {[
                { color: '#0f9f6e', label: '投稿準備完了' },
                { color: '#f59e0b', label: '下書き' },
                { color: '#64748b', label: '投稿済み' },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Selected day pane */}
        <div className="flex-1 min-w-0 w-full">
          <div
            className="rounded-[12px] px-5 py-3 mb-4 flex items-center gap-3"
            style={{ background: 'rgba(18,103,242,0.05)', border: '1px solid rgba(18,103,242,0.14)' }}
          >
            <CalendarDays size={16} style={{ color: 'var(--primary)' }} />
            <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              })}
            </span>
            <span className="text-xs ml-auto font-mono" style={{ color: 'var(--text-faint)' }}>
              {selectedArticles.length > 0 ? `${selectedArticles.length}件` : '記事なし'}
            </span>
          </div>

          {selectedArticles.length === 0 && (
            <div
              className="rounded-[14px] p-12 flex flex-col items-center gap-3 text-center"
              style={{ background: 'var(--surface-raised)', border: '1.5px dashed var(--border)' }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(18,103,242,0.06)', border: '1px solid rgba(18,103,242,0.12)' }}
              >
                <FileText size={22} style={{ color: 'var(--primary)' }} />
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                  この日に予定された記事はありません
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                  保存済み記事一覧から投稿予定日を設定してください
                </p>
              </div>
              <button
                onClick={() => router.push('/articles')}
                className="mt-1 min-h-[38px] px-5 rounded-[9px] text-xs font-semibold text-white transition-all hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
                  boxShadow: '0 4px 12px rgba(18,103,242,0.28)',
                }}
              >
                記事一覧へ
              </button>
            </div>
          )}

          <div className="space-y-3">
            {selectedArticles.map(article => {
              const st =
                article.status === 'published'
                  ? { label: '投稿済み', color: '#64748b', bg: '#f8fafc' }
                  : article.status === 'ready'
                    ? { label: '投稿準備完了', color: '#0f9f6e', bg: '#ecfdf5' }
                    : { label: '下書き', color: '#c77916', bg: '#fffbeb' }
              const scheduleStage = getScheduleStage(article)

              return (
                <div
                  key={article.id}
                  className="rounded-[14px] p-5"
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="nas-badge" style={{ color: scheduleStage.color, background: scheduleStage.bg }}>
                      <span className="nas-badge-dot" style={{ background: scheduleStage.color }} />
                      {scheduleStage.label}
                    </span>
                  </div>
                  <div className="flex items-start gap-4">
                    {article.imageUrl ? (
                      <img src={article.imageUrl} alt="" loading="lazy" className="rounded-[8px] object-cover flex-shrink-0" style={{ width: 72, height: 50 }} />
                    ) : (
                      <div className="rounded-[8px] flex-shrink-0 flex items-center justify-center" style={{ width: 72, height: 50, background: 'rgba(18,103,242,0.06)' }}>
                        <FileText size={18} style={{ color: 'var(--primary)' }} />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="nas-badge" style={{ color: st.color, background: st.bg }}>
                          <span className="nas-badge-dot" style={{ background: st.color }} />
                          {st.label}
                        </span>
                        {article.targetKeyword && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-mono"
                            style={{ color: 'var(--primary)', background: 'rgba(18,103,242,0.07)', border: '1px solid rgba(18,103,242,0.18)' }}
                          >
                            KW: {article.targetKeyword}
                          </span>
                        )}
                      </div>
                      <h3 className="font-semibold text-sm leading-snug" style={{ color: 'var(--ink)' }}>
                        {article.refinedTitle || article.title}
                      </h3>
                      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--text-faint)' }}>
                        {article.wordCount?.toLocaleString() ?? 0}文字
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {article.status !== 'published' && (
                        <button
                          onClick={() => router.push(`/editor?articleId=${article.id}&step=5`)}
                          className="flex items-center gap-1.5 min-h-[34px] px-3 rounded-[8px] text-xs font-semibold text-white transition-all hover:brightness-110"
                          style={{ background: 'var(--danger)', boxShadow: '0 2px 8px rgba(229,62,79,0.22)' }}
                        >
                          <Send size={12} />
                          投稿する
                        </button>
                      )}
                      <button
                        onClick={() => router.push(`/editor?articleId=${article.id}&step=1`)}
                        className="flex items-center gap-1.5 min-h-[34px] px-3 rounded-[8px] text-xs font-medium transition-colors hover:bg-[rgba(18,103,242,0.07)]"
                        style={{ background: 'rgba(20,44,92,0.05)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                      >
                        <Pencil size={12} />
                        編集する
                      </button>
                      <button
                        onClick={() => setDeleteTargetId(article.id)}
                        className="flex items-center gap-1.5 min-h-[34px] px-3 rounded-[8px] text-xs font-medium transition-colors hover:bg-red-50"
                        style={{ background: 'rgba(229,62,79,0.06)', border: '1px solid rgba(229,62,79,0.20)', color: 'var(--danger)' }}
                      >
                        <Trash2 size={12} />
                        解除
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>日付：</span>
                      <input
                        type="date"
                        value={article.scheduledDate ?? ''}
                        onChange={e => {
                          handleScheduleChange(article.id, e.target.value)
                          setSelectedDate(e.target.value)
                        }}
                        style={inputStyle}
                      />
                      <Clock size={13} style={{ color: 'var(--text-faint)', marginLeft: 2 }} />
                      <input
                        type="time"
                        step={900}
                        value={article.scheduledTime ?? ''}
                        onChange={e => handleTimeChange(article.id, e.target.value)}
                        title="15分刻み（00・15・30・45分）"
                        aria-label="投稿予定時刻（15分刻み）"
                        style={inputStyle}
                      />
                      <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>15分単位</span>
                    </div>

                    {(() => {
                      const autoSlug = article.slug || ''
                      const isCustom = customSlugIds.has(article.id)
                      return (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>スラッグ：</span>
                            <select
                              value={isCustom ? 'custom' : 'auto'}
                              onChange={e => {
                                if (e.target.value === 'auto') {
                                  setCustomSlugIds(prev => { const next = new Set(prev); next.delete(article.id); return next })
                                  handleSlugChange(article.id, autoSlug)
                                } else {
                                  setCustomSlugIds(prev => new Set(prev).add(article.id))
                                }
                              }}
                              style={{ ...inputStyle, flex: 1 }}
                            >
                              <option value="auto">{autoSlug || '(スラッグ未設定)'}</option>
                              <option value="custom">自分で入力</option>
                            </select>
                          </div>
                          {isCustom && (
                            <input
                              type="text"
                              value={article.slug ?? ''}
                              onChange={e => handleSlugChange(article.id, e.target.value)}
                              style={{ ...inputStyle, width: '100%', padding: '5px 8px' }}
                              placeholder="例: ma-advisor-selection-tax-guide"
                            />
                          )}
                        </div>
                      )
                    })()}

                    {article.status !== 'published' && article.scheduledDate && article.scheduledTime && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleScheduledPublish(article)}
                          disabled={publishingId === article.id}
                          className="flex items-center gap-1.5 min-h-[34px] px-4 rounded-[8px] text-xs font-semibold text-white disabled:opacity-60 transition-all hover:brightness-110"
                          style={{
                            background: 'linear-gradient(135deg, #0a3fae 0%, #1267f2 100%)',
                            boxShadow: '0 2px 8px rgba(10,63,174,0.28)',
                          }}
                        >
                          {publishingId === article.id ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              予約投稿中...
                            </>
                          ) : (
                            <>
                              <Clock size={12} />
                              予約投稿する
                            </>
                          )}
                        </button>
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {article.scheduledTime} 自動公開
                        </span>
                      </div>
                    )}

                    {publishResult?.articleId === article.id && (
                      <div
                        className="text-xs px-3 py-2 rounded-[8px]"
                        style={{
                          background: publishResult.success ? '#ecfdf5' : '#fef2f2',
                          color: publishResult.success ? '#0f9f6e' : 'var(--danger)',
                          border: `1px solid ${publishResult.success ? '#6ee7b7' : '#fca5a5'}`,
                        }}
                      >
                        {publishResult.message}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {(() => {
            const unscheduled = articles.filter(a => !a.scheduledDate && a.status !== 'published')
            if (unscheduled.length === 0) return null
            return (
              <div className="mt-6">
                <p className="text-xs font-semibold mb-3 font-mono" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>
                  投稿日未設定の記事 ({unscheduled.length}件)
                </p>
                <div className="space-y-2">
                  {unscheduled.map(article => (
                    <div
                      key={article.id}
                      className="rounded-[12px] px-4 py-3 flex items-center gap-3"
                      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}
                    >
                      <FileText size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                      <span className="flex-1 text-sm truncate" style={{ color: 'var(--text-muted)' }}>
                        {article.refinedTitle || article.title}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => { handleScheduleChange(article.id, selectedDate) }}
                          className="text-xs min-h-[32px] px-3 rounded-[7px] font-medium transition-colors hover:bg-[rgba(18,103,242,0.12)]"
                          style={{ color: 'var(--primary)', background: 'rgba(18,103,242,0.07)', border: '1px solid rgba(18,103,242,0.18)' }}
                        >
                          {new Date(selectedDate + 'T00:00:00').toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })} に追加
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
