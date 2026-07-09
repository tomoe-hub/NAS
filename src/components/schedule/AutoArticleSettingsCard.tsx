'use client'

import { useEffect, useState } from 'react'
import { Power, RefreshCw, CheckCircle2, PauseCircle, CalendarRange, AlertTriangle } from 'lucide-react'

interface AutoArticleSettings {
  enabled: boolean
  startDate?: string
  endDate?: string
  updatedAt: string
}

/** システム既定の自動投稿開始日（設定未指定時にcronが使う値と同じ） */
const SYSTEM_START_DATE = '2026-07-15'

/** 'YYYY-MM-DD' → '2026年7月15日（水）' */
function fmtDateJa(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()]
  return `${y}年${m}月${d}日（${dow}）`
}

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
  const [showStopConfirm, setShowStopConfirm] = useState(false)

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
  const effectiveStart = settings?.startDate ?? SYSTEM_START_DATE
  const effectiveEndLabel = settings?.endDate ? `${fmtDateJa(settings.endDate)}まで` : '無期限'

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

  const handleToggleClick = () => {
    if (!settings || saving) return
    if (settings.enabled) {
      setShowStopConfirm(true)
      return
    }
    if (!window.confirm('自動投稿を再開しますか？\n次の投稿日（月・水・金）から自動生成が再開されます。')) return
    void postUpdate({ enabled: true })
  }

  const handleStopConfirmed = () => {
    setShowStopConfirm(false)
    void postUpdate({ enabled: false })
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

  /** 現在の自動化設定の要約行（カード内表示・停止確認モーダル共通） */
  const settingsSummary: { label: string; value: string }[] = [
    { label: '状態', value: settings === null ? '取得失敗' : enabled ? '稼働中' : '停止中' },
    { label: '投稿日', value: '毎週 月・水・金 の朝9:00に公開（前日朝に自動生成・WP予約投稿）' },
    { label: '実施期間', value: `${fmtDateJa(effectiveStart)} 〜 ${effectiveEndLabel}` },
    { label: 'キーワード選定', value: '月曜=狙い目KW ／ 水曜=手薄カテゴリー補強 ／ 金曜=トレンド上昇KW（GSCデータ蓄積後は実測順位も反映）' },
    { label: 'アイキャッチ', value: '画像ページの画像からランダム選定（連続・同週の重複なし）' },
  ]

  return (
    <>
      {/* 停止確認モーダル */}
      {showStopConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(10,20,50,0.45)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="w-full max-w-md rounded-[18px] p-6 mx-4"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="flex items-center gap-2.5 mb-4">
              <span
                className="inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
                style={{ background: 'rgba(220,38,38,0.1)' }}
              >
                <AlertTriangle size={18} style={{ color: '#dc2626' }} />
              </span>
              <p className="text-base font-bold" style={{ color: 'var(--ink)' }}>
                本当にこの自動化を止めますか？
              </p>
            </div>

            {/* 現在の自動化設定 */}
            <div
              className="rounded-[12px] p-4 mb-4"
              style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)' }}
            >
              <p className="text-xs font-bold mb-2.5" style={{ color: 'var(--ink)' }}>現在の自動化設定</p>
              <dl className="space-y-2">
                {settingsSummary.map(row => (
                  <div key={row.label} className="flex gap-2 text-xs leading-relaxed">
                    <dt className="font-semibold flex-shrink-0 w-[6.5em]" style={{ color: 'var(--text-muted)' }}>{row.label}</dt>
                    <dd style={{ color: 'var(--ink)' }}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <p className="text-xs leading-relaxed mb-5" style={{ color: 'var(--text-muted)' }}>
              停止中は新しい記事の自動生成・予約投稿が行われません。
              既にWordPressに予約済みの記事はそのまま公開されます。再開はいつでも可能です。
            </p>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowStopConfirm(false)}
                className="min-h-[38px] px-4 rounded-[9px] text-sm font-medium transition-colors hover:bg-gray-100"
                style={{ background: 'rgba(20,44,92,0.06)', color: 'var(--ink)' }}
              >
                いいえ
              </button>
              <button
                onClick={handleStopConfirmed}
                className="min-h-[38px] px-4 rounded-[9px] text-sm font-semibold text-white transition-all hover:brightness-110"
                style={{
                  background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                  boxShadow: '0 4px 12px rgba(220,38,38,0.3)',
                }}
              >
                はい、停止する
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className="rounded-[14px] mb-6 overflow-hidden"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
            自動投稿設定
          </h2>
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

        {/* 現在の自動化設定（要約） */}
        {!loading && settings !== null && (
          <div className="px-5 pt-4">
            <div
              className="rounded-[10px] p-3.5"
              style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)' }}
            >
              <p className="text-xs font-bold mb-2" style={{ color: 'var(--ink)' }}>現在の自動化設定</p>
              <dl className="space-y-1.5">
                {settingsSummary.map(row => (
                  <div key={row.label} className="flex gap-2 text-xs leading-relaxed">
                    <dt className="font-semibold flex-shrink-0 w-[7em]" style={{ color: 'var(--text-muted)' }}>{row.label}</dt>
                    <dd style={{ color: 'var(--ink)' }}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}

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
            onClick={handleToggleClick}
            disabled={loading || saving || settings === null}
            className="inline-flex items-center gap-2 min-h-[36px] px-4 rounded-lg text-xs font-bold text-white transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            style={
              enabled
                ? {
                    background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                    boxShadow: '0 4px 12px rgba(220,38,38,0.28)',
                  }
                : {
                    background: 'linear-gradient(135deg, #10b981 0%, #0f766e 100%)',
                    boxShadow: '0 4px 12px rgba(15,159,110,0.28)',
                  }
            }
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
    </>
  )
}
