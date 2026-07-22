'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  Database,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  PenLine,
  RefreshCw,
  Search,
  Settings2,
  X,
} from 'lucide-react'
import SectionTabs from '@/components/navigation/SectionTabs'

interface WhitepaperContentItem {
  s3Key: string
  title: string
  description: string
  downloadPageUrl: string
  targetKeyword: string
  thumbnailKey: string
  updatedAt: string
  size: number
  lastModified: string
  extracted: boolean
}

interface ListResponse {
  items?: WhitepaperContentItem[]
  error?: string
}

async function readApiJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error(`サーバーがJSON以外の応答を返しました（HTTP ${response.status}）。ページを再読み込みしてください。`)
  }
  return response.json() as Promise<T>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function thumbnailUrl(key: string): string | null {
  return key
    ? `/api/whitepaper-content/thumbnail?key=${encodeURIComponent(key)}`
    : null
}

export default function WhitepaperArticlesPage() {
  const router = useRouter()
  const [items, setItems] = useState<WhitepaperContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<WhitepaperContentItem | null>(null)
  const [draft, setDraft] = useState<WhitepaperContentItem | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/whitepaper-content', { cache: 'no-store' })
      const json = await readApiJson<ListResponse>(response)
      if (!response.ok) throw new Error(json.error || '資料一覧を取得できませんでした')
      setItems(json.items ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '資料一覧を取得できませんでした')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchItems()
  }, [fetchItems])

  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !generating) {
        setSelected(null)
        setDraft(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, saving, generating])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ja')
    if (!needle) return items
    return items.filter(item =>
      [item.title, item.s3Key, item.targetKeyword, item.description]
        .join('\n')
        .toLocaleLowerCase('ja')
        .includes(needle)
    )
  }, [items, query])

  const openSettings = (item: WhitepaperContentItem) => {
    setSelected(item)
    setDraft({ ...item })
    setError(null)
    setSuccess(null)
  }

  const request = async (action: 'save' | 'generate') => {
    if (!draft) return
    if (!draft.title.trim() || !draft.targetKeyword.trim() || !draft.downloadPageUrl.trim()) {
      setError('資料名・対象キーワード・資料DLページURLは必須です。')
      return
    }

    action === 'save' ? setSaving(true) : setGenerating(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(
        action === 'generate'
          ? '/api/whitepaper-content/generate'
          : '/api/whitepaper-content',
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'generate' ? draft : { ...draft, action }),
      })
      const json = await readApiJson<{
        error?: string
        articleId?: string
        title?: string
      }>(response)
      if (!response.ok) throw new Error(json.error || '処理に失敗しました')

      if (action === 'generate' && json.articleId) {
        router.push(`/editor?articleId=${encodeURIComponent(json.articleId)}&step=2`)
        return
      }
      setSuccess('資料設定を保存しました。')
      await fetchItems()
      const refreshedResponse = await fetch('/api/whitepaper-content', { cache: 'no-store' })
      const updated = await readApiJson<ListResponse>(refreshedResponse)
      const next = updated.items?.find(item => item.s3Key === draft.s3Key)
      if (next) {
        setSelected(next)
        setDraft({ ...next })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました')
    } finally {
      setSaving(false)
      setGenerating(false)
    }
  }

  return (
    <div className="w-full py-8 max-w-[1200px] mx-auto">
      <SectionTabs
        label="ホワイトペーパー管理"
        tabs={[
          { href: '/whitepaper', label: 'DLユーザー一覧' },
          { href: '/whitepaper/pipeline', label: 'フォローアップ パイプライン' },
          { href: '/whitepaper/articles', label: '資料紹介記事を作成' },
        ]}
      />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: 'var(--ink)' }}>
            <PenLine size={21} />
            資料紹介記事を作成
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            公開サイトの資料DLページで提供中のPDFだけを対象に、CTA付き紹介記事を作成します。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchItems()}
          disabled={loading}
          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[9px] px-3.5 text-xs font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
            boxShadow: '0 4px 12px rgba(18,103,242,0.24)',
          }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          更新
        </button>
      </div>

      <div
        className="mb-5 rounded-[13px] px-4 py-3 text-xs leading-relaxed"
        style={{ background: 'rgba(18,103,242,0.05)', border: '1px solid rgba(18,103,242,0.18)', color: 'var(--ink)' }}
      >
        <strong>https://nihon-teikei.co.jp/whitepaper/</strong> に掲載中の資料だけを表示しています。PDF本文は選択した資料だけを抽出してS3へキャッシュします。記事内のCTAはPDF直リンクではなく、設定した
        <strong>資料ダウンロードページ</strong>へ誘導するため、DynamoDBのDL計測とパイプライン管理を維持できます。
      </div>

      {error && !selected && (
        <div
          className="mb-5 flex items-start gap-2 rounded-[12px] px-4 py-3 text-sm"
          style={{ color: '#c02637', background: 'rgba(229,62,79,0.07)', border: '1px solid rgba(229,62,79,0.24)' }}
        >
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <label
        className="mb-4 flex items-center gap-2 rounded-[12px] px-3"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
      >
        <Search size={15} style={{ color: 'var(--text-faint)' }} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="資料名・対象KW・S3ファイル名で検索"
          className="h-10 w-full bg-transparent text-xs outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </label>

      {loading ? (
        <div
          className="flex min-h-[320px] items-center justify-center gap-2 rounded-[14px] text-sm"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          <Loader2 size={19} className="animate-spin" style={{ color: '#1267f2' }} />
          S3のWhitepapersを読み込んでいます...
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="py-20 text-center rounded-[14px]"
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)' }}
        >
          <FolderOpen size={29} className="mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
          <p className="text-sm font-bold" style={{ color: 'var(--ink)' }}>対象のPDFがありません</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>公開サイトの資料DLページとS3のPDF対応を確認してください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(item => (
            <button
              type="button"
              key={item.s3Key}
              onClick={() => openSettings(item)}
              className="group overflow-hidden rounded-[16px] text-left transition-all hover:-translate-y-1 hover:shadow-lg"
              style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}
            >
              <div
                className="relative flex h-[206px] items-center justify-center overflow-hidden p-4"
                style={{ background: 'linear-gradient(145deg, #eef5ff 0%, #f8fbff 100%)' }}
              >
                {thumbnailUrl(item.thumbnailKey) ? (
                  <img
                    src={thumbnailUrl(item.thumbnailKey) ?? undefined}
                    alt={`${item.title}の表紙`}
                    className="h-full max-w-full rounded-[5px] object-contain shadow-[0_8px_18px_rgba(12,36,82,0.22)] transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <span
                    className="flex h-20 w-16 items-center justify-center rounded-[8px]"
                    style={{ color: '#1267f2', background: '#fff', boxShadow: '0 6px 16px rgba(12,36,82,0.12)' }}
                  >
                    <FileText size={29} />
                  </span>
                )}
                <span
                  className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-bold"
                  style={{ color: '#1267f2', background: 'rgba(255,255,255,0.92)', boxShadow: '0 2px 8px rgba(18,103,242,0.13)' }}
                >
                  公開中資料
                </span>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="line-clamp-2 text-[15px] font-bold leading-snug" style={{ color: '#1267f2' }}>{item.title}</h2>
                  <Settings2 size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--text-faint)' }} />
                </div>
                <p className="mt-1 truncate text-[10px]" style={{ color: 'var(--text-faint)' }}>{item.s3Key}</p>
                {item.description && (
                  <p className="mt-2 line-clamp-2 min-h-[36px] text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{item.description}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatBytes(item.size)}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatDate(item.lastModified)}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{
                      color: item.extracted ? '#0f766e' : '#64748b',
                      background: item.extracted ? 'rgba(15,159,110,0.10)' : 'rgba(100,116,139,0.09)',
                    }}
                  >
                    {item.extracted ? '本文抽出済み' : '初回生成時に本文抽出'}
                  </span>
                  {item.targetKeyword && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                      KW: {item.targetKeyword}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,20,50,0.45)', backdropFilter: 'blur(4px)' }}
          onMouseDown={event => {
            if (event.currentTarget === event.target && !saving && !generating) {
              setSelected(null)
              setDraft(null)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ホワイトペーパー記事設定"
            className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[18px] p-6"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold" style={{ color: '#1267f2' }}>資料紹介記事の設定</p>
                <h2 className="mt-1 text-lg font-bold" style={{ color: 'var(--ink)' }}>{selected.title}</h2>
                <p className="mt-1 break-all text-[10px]" style={{ color: 'var(--text-faint)' }}>{selected.s3Key}</p>
              </div>
              <button
                type="button"
                disabled={saving || generating}
                onClick={() => {
                  setSelected(null)
                  setDraft(null)
                }}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 disabled:opacity-50"
                aria-label="閉じる"
              >
                <X size={17} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>

            {error && (
              <div
                className="mb-4 flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-xs"
                style={{ color: '#c02637', background: 'rgba(229,62,79,0.07)', border: '1px solid rgba(229,62,79,0.22)' }}
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            {success && (
              <div
                className="mb-4 flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-xs font-bold"
                style={{ color: '#0f766e', background: 'rgba(15,159,110,0.08)', border: '1px solid rgba(15,159,110,0.20)' }}
              >
                <CheckCircle2 size={15} />
                {success}
              </div>
            )}

            <div className="space-y-4">
              <label className="block text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                資料の表示タイトル <span style={{ color: '#c02637' }}>*</span>
                <input
                  value={draft.title}
                  onChange={event => setDraft({ ...draft, title: event.target.value })}
                  className="mt-1.5 h-10 w-full rounded-[9px] px-3 text-xs outline-none"
                  style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                />
              </label>
              <label className="block text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                資料概要
                <textarea
                  value={draft.description}
                  onChange={event => setDraft({ ...draft, description: event.target.value })}
                  rows={3}
                  placeholder="資料で学べる内容・対象読者を入力。未入力でもPDF本文から生成します。"
                  className="mt-1.5 w-full resize-y rounded-[9px] p-3 text-xs leading-relaxed outline-none"
                  style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                  対象キーワード <span style={{ color: '#c02637' }}>*</span>
                  <input
                    value={draft.targetKeyword}
                    onChange={event => setDraft({ ...draft, targetKeyword: event.target.value })}
                    placeholder="例: M&A 売り手 進め方"
                    className="mt-1.5 h-10 w-full rounded-[9px] px-3 text-xs outline-none"
                    style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                  />
                </label>
                <label className="block text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                  サムネイルのS3キー
                  <input
                    value={draft.thumbnailKey}
                    onChange={event => setDraft({ ...draft, thumbnailKey: event.target.value })}
                    placeholder="Whitepapers/.../thumbnail.webp"
                    className="mt-1.5 h-10 w-full rounded-[9px] px-3 text-xs outline-none"
                    style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                  />
                </label>
              </div>
              <label className="block text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                資料ダウンロードページURL <span style={{ color: '#c02637' }}>*</span>
                <div className="mt-1.5 flex gap-2">
                  <input
                    value={draft.downloadPageUrl}
                    onChange={event => setDraft({ ...draft, downloadPageUrl: event.target.value })}
                    placeholder="https://nihon-teikei.co.jp/whitepaper-download-.../"
                    className="h-10 min-w-0 flex-1 rounded-[9px] px-3 text-xs outline-none"
                    style={{ color: 'var(--ink)', background: '#fff', border: '1px solid var(--border)' }}
                  />
                  {draft.downloadPageUrl && (
                    <a
                      href={draft.downloadPageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px]"
                      style={{ color: '#1267f2', border: '1px solid var(--border)' }}
                      aria-label="DLページを確認"
                    >
                      <ExternalLink size={15} />
                    </a>
                  )}
                </div>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void request('save')}
                disabled={saving || generating}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[9px] px-4 text-xs font-bold disabled:opacity-50"
                style={{ color: '#1267f2', background: 'rgba(18,103,242,0.06)', border: '1px solid rgba(18,103,242,0.20)' }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                設定を保存
              </button>
              <button
                type="button"
                onClick={() => void request('generate')}
                disabled={saving || generating}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-[10px] px-5 text-xs font-bold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
                  boxShadow: '0 5px 14px rgba(18,103,242,0.28)',
                }}
              >
                {generating ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />}
                {generating ? 'PDFを読み取って記事生成中...' : 'CTA付き紹介記事を作成'}
              </button>
            </div>
            {generating && (
              <p className="mt-3 text-right text-[10px]" style={{ color: 'var(--text-faint)' }}>
                初回はPDF本文抽出を含むため、1〜3分かかる場合があります。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
