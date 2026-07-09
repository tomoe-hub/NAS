'use client'

import { useEffect, useState } from 'react'
import { Bot, Power, RefreshCw, CheckCircle2, PauseCircle, CalendarRange } from 'lucide-react'

interface AutoArticleSettings {
  enabled: boolean
  startDate?: string
  endDate?: string
  updatedAt: string
}

/** システム既定の自動投稿開始日（設定未指定時にcronが使う値と同じ） */
const SYSTEM_START_DATE = '2026-07-15'

/**
 * 自動投稿（月・水・金の自動記事生成→WP予約投稿）のON/OFFと実施期間の設定カード。
 * 設定は S3 の auto-articles/settings.json に保存され、cron実行時に毎回参照される。
 */
export default function AutoArticleSettingsCard() {
  const [settings, setSettings] = useState<AutoArticleSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/auto-article/settings', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled && res.ok) {
          setSettings(data)
          setStartDate(data.startDate ?? '')
          setEndDate(data.endDate ?? '')
        }
      } catch {
        /* 取得失敗時はバッジで表示 */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const enabled = settings?.enabled ?? true

  const postUpdate = async (update: Record<string, unknown>) => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/auto-article/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '設定の保存に失敗しました')
      setSettings(data)
      setStartDate(data.startDate ?? '')
      setEndDate(data.endDate ?? '')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '設定の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = () => {
    if (!settings || saving) return
    const next = !settings.enabled
    const confirmMsg = next
      ? '自動投稿を再開しますか？\n次の投稿日（月・水・金）から自動生成が再開されます。'
      : '自動投稿を停止しますか？\n停止中は新しい記事の自動生成・予約投稿が行われません。\n（既にWordPressに予約済みの記事はそのまま公開されます）'
    if (!window.confirm(confirmMsg)) return
    void postUpdate({ enabled: next })
  }

  const handleSavePeriod = () => {
    if (saving) return
    if (startDate && endDate && startDate > endDate) {
      setError('開始日は終了日以前にしてください')
      return
    }
    void postUpdate({ startDate, endDate })
  }

  const periodChanged =
    settings != null && (startDate !== (settings.startDate ?? '') || endDate !== (settings.endDate ?? ''))

  const dateInputStyle = {
    border: '1px solid var(--border)',
    background: 'white',
    color: 'var(--ink)',
    borderRadius: '8px',
    padding: '5px 10px',
    fontSize: '12px',
  }

  return (
    <div
      className="rounded-[14px] mb-6 overflow-hidden"
      style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <Bot size={16} style={{ color: 'var(--primary)' }} />
          <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
            自動投稿設定（月・水・金 朝9時公開）
          </h2>
        </div>
        {loading ? (
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>読み込み中...</span>
        ) : settings === null ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">
            状態取得失敗
          </span>
        ) : enabled ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: 'rgba(15,159,110,0.1)', color: '#0f766e' }}>
            <CheckCircle2 size={13} />
            稼働中
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: 'rgba(220,38,38,0.08)', color: '#b91c1c' }}>
            <PauseCircle size={13} />
            停止中
          </span>
        )}
      </div>

      <div className="px-5 py-4 flex flex-wrap items-end justify-between gap-4">
        {/* 期間設定 */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
              <CalendarRange size={11} className="inline mr-1 -mt-0.5" />
              開始日（空欄＝{SYSTEM_START_DATE}）
            </label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              style={dateInputStyle}
              disabled={loading || settings === null}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
              終了日（空欄＝無期限）
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              style={dateInputStyle}
              disabled={loading || settings === null}
            />
          </div>
          <button
            onClick={handleSavePeriod}
            disabled={loading || saving || settings === null || !periodChanged}
            className="inline-flex items-center gap-1.5 min-h-[32px] px-3.5 rounded-[8px] text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)' }}
          >
            {saving ? <RefreshCw size={12} className="animate-spin" /> : null}
            期間を保存
          </button>
          {saved && (
            <span className="text-xs font-semibold pb-1.5" style={{ color: '#0f766e' }}>保存しました</span>
          )}
        </div>

        {/* ON/OFF */}
        <button
          onClick={handleToggle}
          disabled={loading || saving || settings === null}
          className="inline-flex items-center gap-2 min-h-[36px] px-4 rounded-lg text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          style={{ backgroundColor: enabled ? '#dc2626' : '#0f9f6e' }}
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Power size={14} />}
          {enabled ? '自動化をやめる' : '自動化する'}
        </button>
      </div>

      <div className="px-5 pb-3 -mt-1">
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          設定した期間内の月・水・金のみ自動生成・予約投稿されます。停止/期間外でも既にWP予約済みの記事はそのまま公開されます。
          {settings?.updatedAt ? ` 最終変更: ${new Date(settings.updatedAt).toLocaleString('ja-JP')}` : ''}
        </p>
        {error && (
          <p className="text-[11px] font-semibold mt-1" style={{ color: 'var(--danger)' }}>{error}</p>
        )}
      </div>
    </div>
  )
}
