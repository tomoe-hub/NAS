'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { CalendarClock, Power, RefreshCw, CheckCircle2, PauseCircle } from 'lucide-react'

interface AutoArticleSettings {
  enabled: boolean
  updatedAt: string
}

/** 自動投稿スケジュールの説明（曜日ローテーション） */
const SCHEDULE_ROWS = [
  {
    day: '月曜',
    slot: '狙い目KW',
    color: '#1267F2',
    description: 'KW分析の優先度スコア最上位のキーワード（★★★即攻め→★★有望の順）。検索流入の獲得を狙う攻めの記事。',
  },
  {
    day: '水曜',
    slot: '手薄カテゴリー補強',
    color: '#E67E22',
    description: '記事分析で判定した記事数の少ないタグ領域の関連KW。サイトのカテゴリー網羅性・トピッククラスターを強化。',
  },
  {
    day: '金曜',
    slot: 'トレンド上昇KW',
    color: '#0f9f6e',
    description: '検索ボリュームが上昇傾向のキーワードを上昇率順に選定。時流に乗った記事で先行者優位を確保。',
  },
] as const

export default function NoticePage() {
  const [settings, setSettings] = useState<AutoArticleSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/auto-article/settings', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled && res.ok) setSettings(data)
      } catch {
        /* 表示は「取得失敗」フォールバック */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [])

  const handleToggle = useCallback(async () => {
    if (!settings || saving) return
    const next = !settings.enabled
    const confirmMsg = next
      ? '自動投稿を再開しますか？\n次の投稿日（月・水・金）から自動生成が再開されます。'
      : '自動投稿を停止しますか？\n停止中は新しい記事の自動生成・予約投稿が行われません。\n（既にWordPressに予約済みの記事はそのまま公開されます）'
    if (!window.confirm(confirmMsg)) return

    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/auto-article/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '設定の保存に失敗しました')
      setSettings(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '設定の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [settings, saving])

  const enabled = settings?.enabled ?? true

  return (
    <div className="w-full py-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>注意書き</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        記事の自動投稿（月・水・金）の仕組みと、手動で記事を作成する場合の注意事項です。
      </p>

      {/* ── 自動投稿の仕組み ─────────────────────────────── */}
      <div
        className="rounded-[14px] p-6 sm:p-8 mb-6"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid rgba(18,103,242,0.18)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-3 pb-2 mb-4" style={{ borderBottom: '2px solid rgba(18,103,242,0.22)' }}>
          <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--primary)' }}>
            <CalendarClock size={18} />
            記事の自動投稿（月・水・金）
          </h2>
          {/* 稼働状態バッジ */}
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <RefreshCw size={12} className="animate-spin" />
              状態を確認中...
            </span>
          ) : settings === null ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500">
              状態取得失敗
            </span>
          ) : enabled ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: 'rgba(15,159,110,0.1)', color: '#0f766e' }}>
              <CheckCircle2 size={13} />
              自動投稿 稼働中
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold" style={{ background: 'rgba(220,38,38,0.08)', color: '#dc2626' }}>
              <PauseCircle size={13} />
              自動投稿 停止中
            </span>
          )}
        </div>

        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
          <strong className="font-semibold" style={{ color: 'var(--ink)' }}>2026年7月15日（水）から、毎週 月・水・金の朝9:00</strong>
          に記事が自動でWordPressに公開されます。キーワードの選定から執筆・推敲・アイキャッチ生成・予約投稿まで全自動です。
        </p>

        {/* 曜日ローテーション表 */}
        <div className="overflow-x-auto mb-5">
          <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="text-left px-3 py-2 text-xs font-bold whitespace-nowrap" style={{ color: 'var(--text-muted)', background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)', borderRadius: '8px 0 0 0' }}>公開日</th>
                <th className="text-left px-3 py-2 text-xs font-bold whitespace-nowrap" style={{ color: 'var(--text-muted)', background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)', borderLeft: 'none' }}>記事の枠</th>
                <th className="text-left px-3 py-2 text-xs font-bold" style={{ color: 'var(--text-muted)', background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)', borderLeft: 'none', borderRadius: '0 8px 0 0' }}>キーワードの選び方・ねらい</th>
              </tr>
            </thead>
            <tbody>
              {SCHEDULE_ROWS.map((row, i) => (
                <tr key={row.day}>
                  <td className="px-3 py-2.5 font-bold whitespace-nowrap align-top" style={{ color: 'var(--ink)', border: '1px solid var(--border)', borderTop: 'none', ...(i === SCHEDULE_ROWS.length - 1 ? { borderRadius: '0 0 0 8px' } : {}) }}>
                    {row.day} 9:00
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap align-top" style={{ border: '1px solid var(--border)', borderTop: 'none', borderLeft: 'none' }}>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold text-white" style={{ backgroundColor: row.color }}>
                      {row.slot}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 leading-relaxed align-top" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)', borderTop: 'none', borderLeft: 'none', ...(i === SCHEDULE_ROWS.length - 1 ? { borderRadius: '0 0 8px 0' } : {}) }}>
                    {row.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 運用フロー・共通ルール */}
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold mb-2" style={{ color: 'var(--ink)' }}>処理の流れ</p>
            <ol className="text-xs leading-relaxed space-y-1.5 list-decimal list-inside" style={{ color: 'var(--text-muted)' }}>
              <li>公開日の<strong>前日 朝6時ごろ</strong>にキーワードを自動選定</li>
              <li>一次執筆（S3資料RAG・過去記事の重複回避・競合データ参照）</li>
              <li>AI推敲 → スラッグ生成 → アイキャッチ画像を自動生成</li>
              <li>WordPressに<strong>翌日9:00公開の予約投稿</strong>として登録</li>
              <li>公開まで丸1日、WP管理画面の予約一覧で内容を確認・修正可能</li>
            </ol>
          </div>
          <div className="rounded-[10px] p-4" style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold mb-2" style={{ color: 'var(--ink)' }}>共通ルール</p>
            <ul className="text-xs leading-relaxed space-y-1.5" style={{ color: 'var(--text-muted)' }}>
              <li>・直近<strong>90日以内</strong>に投稿済みのKWは選ばない（カニバリ防止）</li>
              <li>・同一KWで書く場合も過去記事と<strong>内容が被らない</strong>よう自動制御</li>
              <li>・自社ブランド系KW（日本提携支援 等）は対象外</li>
              <li>・タグは既存WPタグから自動付与（手薄枠は該当タグを付与）</li>
              <li>・生成済み記事は「保存済み記事一覧」にも自動保存</li>
            </ul>
          </div>
        </div>

        {/* ON/OFF切り替え */}
        <div className="flex items-center justify-between flex-wrap gap-3 rounded-[10px] p-4" style={{ background: enabled ? 'rgba(15,159,110,0.06)' : 'rgba(220,38,38,0.05)', border: `1px solid ${enabled ? 'rgba(15,159,110,0.22)' : 'rgba(220,38,38,0.2)'}` }}>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
              {enabled ? '自動投稿は稼働中です' : '自動投稿は停止中です'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {enabled
                ? '停止しても、既にWordPressに予約済みの記事はそのまま公開されます。'
                : '再開すると、次の投稿日（月・水・金）から自動生成が再開されます。'}
              {settings?.updatedAt ? ` 最終変更: ${new Date(settings.updatedAt).toLocaleString('ja-JP')}` : ''}
            </p>
            {error && <p className="text-xs mt-1 text-red-600">{error}</p>}
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={loading || saving || settings === null}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            style={{ backgroundColor: enabled ? '#dc2626' : '#0f9f6e' }}
          >
            {saving ? <RefreshCw size={15} className="animate-spin" /> : <Power size={15} />}
            {saving ? '保存中...' : enabled ? '自動化をやめる' : '自動化する'}
          </button>
        </div>
      </div>

      {/* ── 手動作成時の注意（プロンプトひな形 V2） ─────────── */}
      <div
        className="rounded-[14px] p-5 sm:p-6 mb-6"
        style={{
          background: 'rgba(15,159,110,0.06)',
          border: '1px solid rgba(15,159,110,0.22)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <p className="text-xs font-semibold mb-2" style={{ color: '#0f766e' }}>手動で記事を作成する場合</p>
        <p className="text-sm leading-relaxed mb-2" style={{ color: '#134e4a' }}>
          一次執筆用のプロンプトは、<strong className="font-semibold" style={{ color: '#0f766e' }}>基本プロンプト ひな形 V2</strong>
          の利用を推奨します。
          <Link
            href="/prompts"
            className="ml-1 font-semibold underline underline-offset-2 hover:opacity-80"
            style={{ color: 'var(--primary)' }}
          >
            プロンプトライブラリ
          </Link>
          から該当テンプレートを選択してください。
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>理由：</span>
          最終アウトプット時のレイアウト・体裁・見出しなどの表現における<strong>デザインの揺れ防止</strong>のためです。ひな形
          V2 をベースに必要な指示を追加する運用を想定しています。なお、KW分析・記事分析からの記事作成と月水金の自動投稿では、
          KWデータに基づくプロンプトが自動で構築されるため、手動でのプロンプト選択は不要です。
        </p>
      </div>

      {/* ── ターゲットキーワード ─────────────────────────── */}
      <div
        className="rounded-[14px] p-6 sm:p-8 mb-6"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid rgba(18,103,242,0.18)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <h2 className="text-base font-bold pb-2 mb-4" style={{ color: 'var(--primary)', borderBottom: '2px solid rgba(18,103,242,0.22)' }}>
          ターゲットキーワード（必須・構造化データ）
        </h2>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
          手動で一次執筆する際の<strong className="font-semibold" style={{ color: 'var(--ink)' }}>ターゲットキーワードは必ず入れてください</strong>
          （自動投稿では自動で設定されます）。
        </p>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
          入力内容は、WordPress 投稿に含まれる構造化データ（JSON-LD）の{' '}
          <code
            className="rounded px-1.5 py-0.5 text-xs font-mono"
            style={{ color: 'var(--primary)', background: 'rgba(18,103,242,0.07)', border: '1px solid rgba(18,103,242,0.18)' }}
          >
            keywords
          </code>{' '}
          に反映されます。コード（裏側）の記述例は次の通りです。
        </p>
        <pre
          className="mb-4 overflow-x-auto rounded-[10px] p-4 text-xs leading-relaxed font-mono"
          style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          tabIndex={0}
        >{`"keywords": "M&A 手数料 高い, ma 手数料, M&A手数料, M&A コスト",`}</pre>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Google でユーザーがそれらの検索をしたときに表示される仕組みになっているため、
          <strong className="font-semibold" style={{ color: 'var(--ink)' }}>とても重要な項目</strong>です。
        </p>
      </div>
    </div>
  )
}
