'use client'

/**
 * 記事分析ページ
 * WordPress のカテゴリー・タグの記事件数を取得し、
 * 今どのテーマの記事がどれだけ投稿されているかを横棒グラフで可視化する。
 */

import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, PieChart, Hash, FolderTree, AlertCircle } from 'lucide-react'
import type { WpTagListItem } from '@/lib/wpTagList'

interface WpCategoryListItem {
  id: number
  name: string
  slug: string
  count?: number
  parent?: number
}

const BAR_COLORS = [
  '#002C93', '#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA',
  '#0E7490', '#0891B2', '#06B6D4', '#22D3EE', '#67E8F9',
]

function HorizontalBarChart({
  items,
  emptyLabel,
}: {
  items: { name: string; count: number }[]
  emptyLabel: string
}) {
  const max = useMemo(() => Math.max(1, ...items.map(i => i.count)), [items])
  const total = useMemo(() => items.reduce((s, i) => s + i.count, 0), [items])

  if (items.length === 0) {
    return (
      <p className="text-sm text-[#94A3B8] py-8 text-center">{emptyLabel}</p>
    )
  }

  return (
    <div className="space-y-2.5">
      {items.map((item, i) => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
        return (
          <div key={item.name} className="flex items-center gap-3">
            <div className="w-44 flex-shrink-0 text-right">
              <span className="text-[13px] font-medium text-[#334155] leading-tight break-all">
                {item.name}
              </span>
            </div>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <div className="flex-1 h-6 rounded-md bg-[#F1F5F9] overflow-hidden">
                <div
                  className="h-full rounded-md transition-all duration-500"
                  style={{
                    width: `${Math.max(2, (item.count / max) * 100)}%`,
                    backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                  }}
                />
              </div>
              <span className="w-20 flex-shrink-0 text-[13px] tabular-nums text-[#475569] font-semibold">
                {item.count}件
                <span className="text-[11px] font-normal text-[#94A3B8] ml-1">({pct}%)</span>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function ArticleAnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<WpCategoryListItem[]>([])
  const [tags, setTags] = useState<WpTagListItem[]>([])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [catRes, tagRes] = await Promise.all([
        fetch('/api/wordpress/categories?per_page=100', { cache: 'no-store' }),
        fetch('/api/wordpress/tags?per_page=100', { cache: 'no-store' }),
      ])
      const catData = await catRes.json()
      const tagData = await tagRes.json()

      if (!catRes.ok && !tagRes.ok) {
        throw new Error(catData.error || tagData.error || 'データの取得に失敗しました')
      }

      setCategories(Array.isArray(catData.categories) ? catData.categories : [])
      setTags(Array.isArray(tagData.tags) ? tagData.tags : [])

      if (!catRes.ok) setError(`カテゴリー取得エラー: ${catData.error ?? catRes.status}`)
      else if (!tagRes.ok) setError(`タグ取得エラー: ${tagData.error ?? tagRes.status}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categoryItems = useMemo(
    () =>
      categories
        .filter(c => (c.count ?? 0) > 0)
        .map(c => ({ name: c.name, count: c.count ?? 0 }))
        .sort((a, b) => b.count - a.count),
    [categories]
  )

  const tagItems = useMemo(
    () =>
      tags
        .filter(t => (t.count ?? 0) > 0)
        .map(t => ({ name: t.name, count: t.count ?? 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30),
    [tags]
  )

  const totalCategorized = useMemo(
    () => categoryItems.reduce((s, c) => s + c.count, 0),
    [categoryItems]
  )
  const activeTags = useMemo(() => tags.filter(t => (t.count ?? 0) > 0).length, [tags])

  return (
    <div className="w-full max-w-5xl py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-[#1A1A2E] flex items-center gap-2">
          <PieChart size={24} className="text-[#002C93]" />
          記事分析
        </h1>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: '#002C93' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          更新
        </button>
      </div>
      <p className="text-sm text-[#64748B] mb-8">
        WordPress（nihon-teikei.co.jp）のカテゴリー・タグ件数と連動し、投稿済み記事のテーマ分布を可視化します。
      </p>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* サマリーカード */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <p className="text-xs font-semibold text-[#64748B] mb-1">カテゴリー付き記事数（延べ）</p>
          <p className="text-3xl font-black text-[#1A1A2E] tabular-nums">
            {loading ? '—' : totalCategorized.toLocaleString()}
            <span className="text-sm font-semibold text-[#94A3B8] ml-1">件</span>
          </p>
        </div>
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <p className="text-xs font-semibold text-[#64748B] mb-1">使用中カテゴリー数</p>
          <p className="text-3xl font-black text-[#1A1A2E] tabular-nums">
            {loading ? '—' : categoryItems.length.toLocaleString()}
            <span className="text-sm font-semibold text-[#94A3B8] ml-1">個</span>
          </p>
        </div>
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
          <p className="text-xs font-semibold text-[#64748B] mb-1">使用中タグ数</p>
          <p className="text-3xl font-black text-[#1A1A2E] tabular-nums">
            {loading ? '—' : activeTags.toLocaleString()}
            <span className="text-sm font-semibold text-[#94A3B8] ml-1">個</span>
          </p>
        </div>
      </div>

      {/* カテゴリー別グラフ */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 mb-6">
        <h2 className="text-base font-bold text-[#1A1A2E] mb-5 flex items-center gap-2">
          <FolderTree size={18} className="text-[#002C93]" />
          カテゴリー別 記事数
        </h2>
        {loading ? (
          <p className="text-sm text-[#94A3B8] py-8 text-center">読み込み中...</p>
        ) : (
          <HorizontalBarChart
            items={categoryItems}
            emptyLabel="カテゴリーデータがありません"
          />
        )}
      </div>

      {/* タグ別グラフ */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
        <h2 className="text-base font-bold text-[#1A1A2E] mb-1 flex items-center gap-2">
          <Hash size={18} className="text-[#002C93]" />
          タグ別 記事数（上位30）
        </h2>
        <p className="text-xs text-[#94A3B8] mb-5">
          どのテーマの記事が多く投稿されているかの分布です。少ないタグ領域が今後のKW候補になります。
        </p>
        {loading ? (
          <p className="text-sm text-[#94A3B8] py-8 text-center">読み込み中...</p>
        ) : (
          <HorizontalBarChart
            items={tagItems}
            emptyLabel="タグデータがありません"
          />
        )}
      </div>
    </div>
  )
}
