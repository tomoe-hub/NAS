'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useEffect, Suspense } from 'react'
import StepIndicator from '@/components/editor/StepIndicator'
import type { Step } from '@/lib/types'
import { getSupervisorBlockHtml } from '@/lib/supervisorBlock'
import { normalizeBoldLabelLines, convertConsecutiveHeadingsToBullets } from '@/lib/contentFormat'

const DUMMY_ARTICLES = [
  {
    date: '2025.12.23',
    category: '導入事例',
    title: '【M&A成約インタビュー vol.4】半世紀の建設キャリアを未来へつなぐ',
  },
  {
    date: '2025.12.12',
    category: 'お知らせ',
    title: '【登壇報告】弊社代表・大野 駿介が「財務の戦略デザイン研究会」にて講演しました',
  },
]

/** 監修者・丸部分のお顔画像（WordPressメディアライブラリ）。プレビューではこのURLを直接表示。 */
const SUPERVISOR_FACE_IMAGE_URL = 'http://nihon-teikei.co.jp/wp-content/uploads/2026/03/3159097ae625791c1a400e6900330153.png'

/** プレビュー用CTAバナーHTML */
function getPreviewCtaBannerHtml(): string {
  const cloudFrontUrl = process.env.NEXT_PUBLIC_CLOUDFRONT_URL?.trim()
  const bannerUrl = cloudFrontUrl
    ? `${cloudFrontUrl}/data-for-nas/pictures/NTS+CTA+%E9%9B%BB%E8%A9%B1%E7%95%AA%E5%8F%B7%E4%BB%98%E3%81%8D.png`
    : 'https://data-for-nas.s3.ap-northeast-1.amazonaws.com/pictures/NTS+CTA+%E9%9B%BB%E8%A9%B1%E7%95%AA%E5%8F%B7%E4%BB%98%E3%81%8D.png'
  return `<div style="text-align:center;margin:40px 0;padding:0;"><a href="https://nihon-teikei.co.jp/contact/" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;"><img src="${bannerUrl}" alt="M&Aの専門家に無料で相談してみる" style="max-width:100%;width:700px;height:auto;border:none;border-radius:8px;" loading="lazy" /></a></div>`
}

/** プレビュー用: CTAバナーを「まとめ」h2の直前に挿入 */
function insertCtaBannersForPreview(html: string): string {
  const cta = getPreviewCtaBannerHtml()

  // 優先: 「まとめ」を含む h2 タグの直前に挿入
  const matomeRegex = /<h2[^>]*>[^<]*まとめ[^<]*<\/h2>/gi
  const matomeMatch = matomeRegex.exec(html)
  if (matomeMatch) {
    return html.slice(0, matomeMatch.index) + cta + '\n' + html.slice(matomeMatch.index)
  }

  const matomeBlockRegex = /<(h2|h3|p)[^>]*>\s*(?:<strong>)?\s*まとめ[\s\S]*?<\/\1>/i
  const matomeBlockMatch = matomeBlockRegex.exec(html)
  if (matomeBlockMatch && matomeBlockMatch.index !== undefined) {
    return html.slice(0, matomeBlockMatch.index) + cta + '\n' + html.slice(matomeBlockMatch.index)
  }

  // フォールバック: 最後の h2 の直前に挿入
  const h2Regex = /<h2[\s>]/gi
  let match: RegExpExecArray | null
  const positions: number[] = []
  while ((match = h2Regex.exec(html)) !== null) {
    positions.push(match.index)
  }
  if (positions.length >= 2) {
    const lastPos = positions[positions.length - 1]!
    return html.slice(0, lastPos) + cta + '\n' + html.slice(lastPos)
  }

  return html + '\n' + cta
}

function formatContent(content: string, imageUrl: string): string {
  // 「**ラベル：本文**」のような太字ラップ行を見出し+段落に正規化してから
  // 既存の行単位パースへ流す（公開時の WordPress 変換と同じ事前処理）。
  const normalized = convertConsecutiveHeadingsToBullets(normalizeBoldLabelLines(content))

  const imageHtml = imageUrl
    ? `<img src="${imageUrl}" style="width:100%;height:auto;margin-bottom:32px;display:block;" alt="" />`
    : ''

  const supervisorBlock = getSupervisorBlockHtml(SUPERVISOR_FACE_IMAGE_URL)

  const H2_STYLE = "font-size:22px;font-weight:900;margin:48px 0 16px;padding-bottom:8px;border-bottom:3px solid #0e357f;font-family:'Noto Sans JP',sans-serif;"
  // NAS プレビューでも NTS サイトと同じ見出し下線を出すため、h3 にも
  // 細めの下線（#0e357f）を付けて「1-1. 見出し」の視認性を上げる。
  const H3_STYLE = "font-size:18px;font-weight:700;margin:32px 0 12px;padding-bottom:6px;border-bottom:1px solid #0e357f;color:#0e357f;font-family:'Noto Sans JP',sans-serif;"
  const P_STYLE = 'margin-bottom:1.6em;'

  const applyInlineFormatting = (text: string): string =>
    text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+?)__/g, '$1')
      .replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
      .replace(/\*\*/g, '')

  const lines = normalized.split('\n')
  const htmlLines: string[] = []
  let currentParagraph: string[] = []

  const flushParagraph = () => {
    if (currentParagraph.length === 0) return
    const raw = currentParagraph.join('<br>').trim()
    if (raw) {
      htmlLines.push(`<p style="${P_STYLE}">${applyInlineFormatting(raw)}</p>`)
    }
    currentParagraph = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      continue
    }

    if (/^\d+[．.]\s/.test(trimmed) && currentParagraph.length === 0) {
      const text = trimmed.replace(/^\d+[．.]\s*/, '')
      htmlLines.push(`<h2 style="${H2_STYLE}">${applyInlineFormatting(text)}</h2>`)
      continue
    }

    if (/^\d+-\d+[．.]\s/.test(trimmed) && currentParagraph.length === 0) {
      const text = trimmed.replace(/^\d+-\d+[．.]\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1')
      htmlLines.push(`<h3 style="${H3_STYLE}">${text}</h3>`)
      continue
    }

    if (/^[■▶◆●▼]\s/.test(trimmed)) {
      flushParagraph()
      const text = trimmed.replace(/^[■▶◆●▼]\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1')
      htmlLines.push(`<h3 style="${H3_STYLE}">${text}</h3>`)
      continue
    }

    // 行全体が **...** だけ（末尾の句読点・コロンは許容）の場合は h3 に昇格。
    // 例: "**M&Aの目的設定と戦略立案：...**" のような太字ラベル行が連続するパターンを
    // 段落ではなく見出しとしてレンダリングし、投稿できる体裁を保つための後処理。
    if (/^\*\*[^*\n]+\*\*[\s　]*[：:。．.、,]?[\s　]*$/.test(trimmed) && currentParagraph.length === 0) {
      const text = trimmed
        .replace(/^\*\*/, '')
        .replace(/\*\*[\s　]*[：:。．.、,]?[\s　]*$/, '')
        .trim()
      if (text) {
        htmlLines.push(`<h3 style="${H3_STYLE}">${text}</h3>`)
        continue
      }
    }

    currentParagraph.push(trimmed)
  }

  flushParagraph()
  let bodyHtml = htmlLines.join('\n')

  bodyHtml = bodyHtml
    .replace(
      /導入事例はこちらから\s+https?:\/\/nihon-teikei\.co\.jp\/news\/casestudy\/?/g,
      '<a href="https://nihon-teikei.co.jp/news/casestudy/" target="_blank" rel="noopener noreferrer" style="color:#0e357f;text-decoration:underline;">導入事例はこちらから</a>'
    )
    .replace(
      /新しいM&A\s+ニュースタンダードはこちら\s+https?:\/\/nihon-teikei\.co\.jp\/ma-newstandard\/?/g,
      '<a href="https://nihon-teikei.co.jp/ma-newstandard/" target="_blank" rel="noopener noreferrer" style="color:#0e357f;text-decoration:underline;">新しいM&A ニュースタンダードはこちら</a>'
    )
    // 旧CTAが残っている記事にも対応（後方互換）
    .replace(
      /待っているだけでオファーが届くM&Aオファーはこちら\s+https?:\/\/nihon-teikei\.com\/ma-offer/g,
      '<a href="https://nihon-teikei.co.jp/ma-newstandard/" target="_blank" rel="noopener noreferrer" style="color:#0e357f;text-decoration:underline;">新しいM&A ニュースタンダードはこちら</a>'
    )

  // 連続見出しタグの HTML 後処理（numbered heading 連続などのガード）
  bodyHtml = bodyHtml
    .replace(/(<\/h3>)([\s\n]*)(<h3)/g, '$1$2<p style="margin:0 0 0.8em;"></p>\n$3')
    .replace(/(<\/h2>)([\s\n]*)(<h2)/g, '$1$2<p style="margin:0 0 1.2em;"></p>\n$3')

  bodyHtml = insertCtaBannersForPreview(bodyHtml)

  return imageHtml + supervisorBlock + bodyHtml
}

function PreviewContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const title = searchParams.get('title') || '（タイトルなし）'
  const contentFromUrl = searchParams.get('content') || ''
  const [storageContent, setStorageContent] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [wordpressUrl, setWordpressUrl] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')

  const isPublishedPreview = searchParams.get('source') === 'published'

  useEffect(() => {
    if (typeof window === 'undefined') return

    setStorageContent(sessionStorage.getItem('preview_content') || '')
    const id = searchParams.get('articleId')
    let storedImage = ''
    let wp: string | null = null

    if (id) {
      try {
        const raw = localStorage.getItem('nas_articles')
        if (raw) {
          const articles = JSON.parse(raw)
          const match = articles.find((a: { id?: string }) => a.id === id)
          if (match) {
            if (typeof match.wordpressUrl === 'string' && match.wordpressUrl.trim()) {
              wp = match.wordpressUrl.trim()
            }
            if (match.imageUrl) storedImage = match.imageUrl
          }
        }
      } catch {
        /* ignore */
      }
    }

    setWordpressUrl(wp)
    if (storedImage) {
      setImageUrl(storedImage)
    } else {
      const sessionImage = sessionStorage.getItem('preview_image')
      setImageUrl(sessionImage || searchParams.get('imageUrl') || '')
    }
  }, [searchParams])

  const content = contentFromUrl || storageContent
  const category = searchParams.get('category') || 'お役立ち情報'
  const date = searchParams.get('date') || new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }).replace(/\//g, '.')
  const articleId = searchParams.get('articleId') || ''

  const formattedContent = useMemo(
    () => formatContent(editMode ? editContent : content, imageUrl),
    [content, editContent, editMode, imageUrl]
  )

  const handleEnterEditMode = () => {
    setEditContent(content)
    setEditMode(true)
  }

  const handleSaveEdit = () => {
    sessionStorage.setItem('preview_content', editContent)
    setStorageContent(editContent)
    setEditMode(false)
  }

  const handleCancelEdit = () => {
    setEditMode(false)
  }

  // 架空数値パターンの検出（警告表示のみ、コンテンツ変更なし）
  const suspiciousPatterns = [
    /年商約?\d+億円/,
    /年商約?\d+千万円/,
    /従業員.*?約?\d+名/,
    /成約.*?約?\d+億/,
    /A社（[^）]*年商/,
  ]
  const hasSuspiciousContent = !editMode && suspiciousPatterns.some(p => p.test(content))

  const handlePublish = useCallback(() => {
    if (articleId) {
      router.push(`/editor?articleId=${articleId}&step=5`)
    } else {
      router.push('/editor?step=5')
    }
  }, [articleId, router])

  const handleStepClick = useCallback(
    (step: Step) => {
      const base = articleId ? `/editor?articleId=${articleId}&step=` : '/editor?step='
      if (step === 1) {
        router.push(`${base}1`)
      } else if (step === 2) {
        router.push(`${base}2`)
      } else if (step === 3) {
        router.push(`${base}3`)
      } else if (step === 4) {
        // 現在プレビュー画面のためそのまま（必要なら同一URLでリロードしない限り何もしない）
      } else if (step === 5) {
        handlePublish()
      }
    },
    [articleId, router, handlePublish]
  )

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      {/* ① 固定バナー（常に表示・投稿画面へ・戻る） */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 220,
          right: 0,
          zIndex: 1000,
          backgroundColor: '#1e3a5f',
          color: 'white',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 20 }}>👁️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>プレビューモード</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {isPublishedPreview
                ? '投稿済み記事の表示確認（編集はできません）'
                : '実際のサイトでの表示イメージを確認しています'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
          {isPublishedPreview ? (
            <>
              <button
                type="button"
                onClick={() => router.push('/published')}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.5)',
                  color: 'white',
                  padding: '10px 20px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                ← 一覧に戻る
              </button>
              {wordpressUrl && (
                <a
                  href={wordpressUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    backgroundColor: '#1a9a7b',
                    border: 'none',
                    color: 'white',
                    padding: '10px 24px',
                    borderRadius: 6,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: 14,
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  WordPressで開く
                </a>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => (articleId ? router.push(`/editor?articleId=${articleId}&step=3`) : router.push('/editor?step=3'))}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.5)',
                  color: 'white',
                  padding: '10px 20px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                ← 戻る
              </button>
              {editMode ? (
                <>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.5)',
                      color: 'white',
                      padding: '10px 18px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: 14,
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    style={{
                      background: 'linear-gradient(135deg, #1267f2 0%, #18a9e6 100%)',
                      border: 'none',
                      color: 'white',
                      padding: '10px 22px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: 14,
                      boxShadow: '0 4px 12px rgba(18,103,242,0.40)',
                    }}
                  >
                    保存して確定
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleEnterEditMode}
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.40)',
                    color: 'white',
                    padding: '10px 18px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  本文を編集する
                </button>
              )}
              <button
                type="button"
                onClick={handlePublish}
                style={{
                  backgroundColor: '#e63946',
                  border: 'none',
                  color: 'white',
                  padding: '10px 24px',
                  borderRadius: 6,
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                投稿画面へ
              </button>
            </>
          )}
        </div>
      </div>

      {/* 架空数値警告バナー */}
      {hasSuspiciousContent && (
        <div
          style={{
            position: 'fixed',
            top: 56,
            left: 220,
            right: 0,
            zIndex: 999,
            background: 'linear-gradient(135deg, #92400e, #b45309)',
            color: 'white',
            padding: '10px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          架空の数値（年商・従業員数等）が含まれている可能性があります。「本文を編集する」から確認・修正してください。
        </div>
      )}

      {/* バナー分のスペーサー + 2カラム（左：プレビュー本文 / 右：プロセス表示） */}
      <div style={{ paddingTop: hasSuspiciousContent ? 96 : 56, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>

      {/* ── 編集モード ── */}
      {editMode && (
        <div
          style={{
            display: 'flex',
            gap: 0,
            height: 'calc(100vh - 56px)',
            overflow: 'hidden',
          }}
        >
          {/* 左ペイン: 生テキスト編集エリア */}
          <div
            style={{
              width: '50%',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRight: '1px solid rgba(20,44,92,0.12)',
              background: '#f8fbff',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(20,44,92,0.10)',
                background: 'rgba(18,103,242,0.04)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1267f2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1267f2' }}>本文を編集</span>
              <span style={{ fontSize: 11, color: '#64788a', marginLeft: 4 }}>
                「見出し名：説明文」の形式の行は、前後に空行を入れると見出しに変換されます
              </span>
            </div>
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{
                flex: 1,
                padding: '16px 20px',
                fontFamily: '"DM Mono", "Courier New", monospace',
                fontSize: 13,
                lineHeight: 1.75,
                color: '#10213f',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'none',
                overflowY: 'auto',
              }}
              spellCheck={false}
            />
          </div>

          {/* 右ペイン: ライブプレビュー */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid rgba(20,44,92,0.10)',
                background: 'rgba(15,159,110,0.04)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0f9f6e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0f9f6e' }}>ライブプレビュー</span>
              <span style={{ fontSize: 11, color: '#64788a', marginLeft: 4 }}>
                左の編集内容がリアルタイムで反映されます
              </span>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px 32px',
                fontFamily: '"Noto Sans JP", sans-serif',
                fontSize: 16,
                lineHeight: 1.9,
                color: '#333',
                background: '#fff',
              }}
              dangerouslySetInnerHTML={{ __html: formattedContent }}
            />
          </div>
        </div>
      )}

      {/* ── 通常プレビューモード（NTSサイト再現） ── */}
      {!editMode && (
        <div>
      {/* ② ヘッダー（クライアントサイト完全再現） */}
      <header
        style={{
          backgroundColor: 'white',
          borderBottom: '1px solid #e5e5e5',
          padding: '0 24px',
          minHeight: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 56,
          zIndex: 998,
          flexWrap: 'nowrap',
          gap: 16,
        }}
      >
        {/* 左：NTSロゴ（API経由でSVGを配信） */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/api/nts-logo"
            alt="NTS 日本提携支援"
            style={{ height: 36, width: 'auto', display: 'block' }}
          />
        </div>

        {/* 中央：ナビゲーション・改行なし */}
        <nav
          style={{
            display: 'flex',
            gap: 28,
            fontSize: 13,
            color: '#333',
            fontWeight: 500,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {[
            '日本提携支援について',
            '事業内容',
            '導入事例',
            'お役立ち情報',
            'ニュース',
            '採用情報',
          ].map(item => (
            <span key={item} style={{ cursor: 'pointer', color: '#222' }}>
              {item}
            </span>
          ))}
        </nav>

        {/* 右：電話 + お問い合わせボタン・1行で表示 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0, whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" stroke="#0e357f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0e357f' }}>03-6667-0221</span>
            </div>
            <span style={{ fontSize: 11, color: '#666', marginTop: 2 }}>電話相談受付:10:00-20:00(年中無休)</span>
          </div>
          <button
            type="button"
            style={{
              backgroundColor: '#0e357f',
              color: 'white',
              padding: '10px 20px',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
            }}
          >
            お問い合わせ
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </header>

      {/* ③ ファーストビュー（NEWSヒーロー） */}
      <section style={{ backgroundColor: '#f5f4f0', padding: '60px 0' }}>
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 40px',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              fontSize: 80,
              fontWeight: 900,
              color: 'rgba(0,0,0,0.04)',
              fontFamily: 'neue-haas-grotesk-display, Arial',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            Hearts and future to the future Hearts
          </div>
          <h1 style={{ position: 'relative' }}>
            <span
              style={{
                display: 'block',
                fontSize: 56,
                fontWeight: 900,
                color: '#1a9a7b',
                fontFamily:
                  '"neue-haas-grotesk-display", "HelveticaNeue", Arial, sans-serif',
                lineHeight: 1,
              }}
            >
              NEWS
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 16,
                color: '#444',
                marginTop: 8,
              }}
            >
              ニュース
            </span>
          </h1>
          <nav
            style={{ marginTop: 16, fontSize: 13, color: '#666' }}
            aria-label="パンくず"
          >
            <span style={{ color: '#0e357f', cursor: 'pointer' }}>TOP</span>
            {' > '}
            <span style={{ color: '#0e357f', cursor: 'pointer' }}>ニュース</span>
            {' > '}
            <span>
              {title.length > 40 ? `${title.slice(0, 40)}...` : title}
            </span>
          </nav>
        </div>
      </section>

      {/* ④ 記事メインコンテンツ */}
      <section style={{ padding: '0 0 80px' }}>
        <div
          style={{
            maxWidth: 960,
            margin: '48px auto',
            padding: '0 24px',
          }}
        >
          <header style={{ marginBottom: 32 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <time
                style={{
                  color: '#1a9a7b',
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                {date}
              </time>
              <span
                style={{
                  backgroundColor: '#1a9a7b',
                  color: 'white',
                  padding: '2px 12px',
                  borderRadius: 3,
                  fontSize: 13,
                }}
              >
                {category}
              </span>
            </div>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 900,
                lineHeight: 1.6,
                color: '#111',
                marginBottom: 24,
                fontFamily: '"Noto Sans JP", sans-serif',
              }}
            >
              {title}
            </h1>
            <ul
              style={{
                display: 'flex',
                gap: 8,
                listStyle: 'none',
                padding: 0,
                margin: 0,
              }}
            >
              {[
                { label: 'X', bg: '#000' },
                { label: 'f', bg: '#1877f2' },
                { label: 'B!', bg: '#00a4de' },
                { label: 'in', bg: '#0077b5' },
                { label: 'LINE', bg: '#06c755' },
              ].map(({ label, bg }) => (
                <li key={label}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      backgroundColor: bg,
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </div>
                </li>
              ))}
            </ul>
          </header>
          <div
            style={{
              fontFamily: '"Noto Sans JP", sans-serif',
              fontSize: 16,
              lineHeight: 1.9,
              color: '#333',
            }}
            dangerouslySetInnerHTML={{ __html: formattedContent }}
          />
        </div>
      </section>

      {/* ⑥ 最新記事グリッド（LATEST NEWS） */}
      <section style={{ backgroundColor: '#f5f4f0', padding: '80px 0' }}>
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 40px',
          }}
        >
          <h2 style={{ marginBottom: 24 }}>
            <span
              style={{
                display: 'block',
                fontSize: 40,
                fontWeight: 900,
                color: '#222',
                fontFamily: '"neue-haas-grotesk-display", Arial',
              }}
            >
              LATEST NEWS
            </span>
            <span style={{ fontSize: 14, color: '#666' }}>最新ニュース</span>
          </h2>
          {/* CATEGORY・TAG（見た目のみ） */}
          <div style={{ marginBottom: 40 }}>
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#222', display: 'block', marginBottom: 8 }}>CATEGORY</span>
              <span style={{ fontSize: 14, color: '#333' }}>
                すべて　インターン　導入事例　お役立ち情報　お知らせ
              </span>
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#222', display: 'block' }}>TAG</span>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 32,
            }}
          >
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: 4,
                overflow: 'hidden',
                border: '2px solid #1a9a7b',
              }}
            >
              <div
                style={{
                  backgroundColor: '#1a9a7b',
                  color: 'white',
                  textAlign: 'center',
                  padding: '6px',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                📍 この記事が表示されます
              </div>
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt=""
                  style={{
                    width: '100%',
                    aspectRatio: '16/9',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '16/9',
                    backgroundColor: '#ddd',
                  }}
                />
              )}
              <div style={{ padding: 16 }}>
                <div
                  style={{
                    color: '#1a9a7b',
                    fontSize: 13,
                    marginBottom: 8,
                  }}
                >
                  {date} {category}
                </div>
                <p
                  style={{
                    fontWeight: 700,
                    fontSize: 15,
                    lineHeight: 1.5,
                    color: '#111',
                  }}
                >
                  {title.length > 50 ? `${title.slice(0, 50)}...` : title}
                </p>
              </div>
            </div>
            {DUMMY_ARTICLES.map((article, i) => (
              <div
                key={i}
                style={{
                  backgroundColor: 'white',
                  borderRadius: 4,
                  overflow: 'hidden',
                  opacity: 0.6,
                }}
              >
                {/* 実際のサイト同様：白地＋NTSロゴ＋NIHON TEIKEI SHIEN */}
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '16/9',
                    backgroundColor: 'white',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 24,
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <img
                    src="/api/nts-logo"
                    alt="NTS"
                    style={{ height: 28, width: 'auto', display: 'block', marginBottom: 6 }}
                  />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: '#0e357f',
                      letterSpacing: '0.08em',
                    }}
                  >
                    NIHON TEIKEI SHIEN
                  </span>
                </div>
                <div style={{ padding: 16 }}>
                  <div
                    style={{
                      color: '#1a9a7b',
                      fontSize: 13,
                      marginBottom: 8,
                    }}
                  >
                    {article.date} {article.category}
                  </div>
                  <p
                    style={{
                      fontWeight: 700,
                      fontSize: 15,
                      lineHeight: 1.5,
                      color: '#111',
                    }}
                  >
                    {article.title}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'right', marginTop: 24 }}>
            <span
              style={{
                color: '#0e357f',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              VIEW ALL →
            </span>
          </div>
        </div>
      </section>

      {/* ⑦ CONTACTセクション */}
      <aside
        style={{
          backgroundColor: '#0e357f',
          color: 'white',
          padding: '80px 0',
          textAlign: 'center',
        }}
      >
        <h2 style={{ marginBottom: 24 }}>
          <span
            style={{
              display: 'block',
              fontSize: 40,
              fontWeight: 900,
              fontFamily: 'Arial',
            }}
          >
            CONTACT
          </span>
          <span style={{ fontSize: 14, opacity: 0.8 }}>お問い合わせ</span>
        </h2>
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            margin: '24px auto',
            width: 480,
          }}
        />
        <p
          style={{
            fontSize: 22,
            fontWeight: 700,
            lineHeight: 1.8,
            marginBottom: 32,
          }}
        >
          あなたの企業の未来に、最適なパートナーを。
          <br />
          ご相談はこちらから。
        </p>
        <div style={{ marginBottom: 32 }}>
          <div
            style={{ fontSize: 13, opacity: 0.8, marginBottom: 8 }}
          >
            電話相談受付 : 10:00-20:00 (年中無休)
          </div>
        </div>
        <button
          type="button"
          style={{
            border: '2px solid white',
            backgroundColor: 'transparent',
            color: 'white',
            padding: '14px 40px',
            borderRadius: 28,
            fontSize: 16,
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          相談・お問い合わせ →
        </button>
      </aside>

      {/* ⑧ フッター */}
      <footer
        style={{
          backgroundColor: '#0a1f4a',
          color: 'white',
          padding: '60px 40px 24px',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 40,
          }}
        >
          <div>
            <div
              style={{ fontWeight: 900, fontSize: 20, marginBottom: 16 }}
            >
              株式会社日本提携支援
            </div>
            <p style={{ fontSize: 13, opacity: 0.6, lineHeight: 1.8 }}>
              〒103-0006
              <br />
              東京都中央区日本橋富沢町10-11 TWG 日本橋イーストⅡ10階
              <br />
              TEL: 03-6667-0221
            </p>
          </div>
          <nav
            style={{
              display: 'flex',
              gap: 48,
              fontSize: 13,
              opacity: 0.8,
            }}
          >
            {/* About / Service / Case Study / Column / News / Recruit */}
          </nav>
        </div>
        <hr
          style={{
            border: 'none',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            marginBottom: 24,
          }}
        />
        <p
          style={{
            textAlign: 'right',
            fontSize: 12,
            opacity: 0.5,
          }}
        >
          Copyright © 日本提携支援. All rights reserved.
        </p>
      </footer>
        </div>
      )}
        </div>
        {!isPublishedPreview && (
          <div style={{ flexShrink: 0, width: 140, position: 'sticky', top: 72, paddingTop: 8 }}>
            <StepIndicator currentStep={4} onStepClick={handleStepClick} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function PreviewPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>読み込み中...</div>}>
      <PreviewContent />
    </Suspense>
  )
}
