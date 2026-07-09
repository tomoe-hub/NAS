/**
 * GET /api/cron/auto-article
 *
 * Vercel Cron から毎日 21:00 UTC（= JST 翌朝6:00）に呼ばれる自動記事生成エンドポイント。
 *
 * フロー:
 * 1. 翌日（JST）が投稿日（月・水・金、2026-07-15以降）かを判定
 * 2. 曜日スロットに応じてKWを自動選定（同一KWは90日クールダウン）
 * 3. 一次執筆（RAG）→ AI推敲 → スラッグ生成 → アイキャッチ生成
 * 4. WordPress に予約投稿（future、翌日 9:00 JST 公開）
 * 5. 記事をS3に保存（embedding も更新）し、実行ログを記録
 *
 * 予約投稿は公開まで丸1日の確認猶予があるため、WP管理画面でレビュー可能。
 *
 * 手動テスト: GET /api/cron/auto-article?date=2026-07-15&force=1
 * （Authorization: Bearer <CRON_SECRET> が必要）
 *
 * 無効化: 環境変数 AUTO_ARTICLE_DISABLED=1
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateDraftArticle } from '@/lib/draftGeneration'
import { refineArticleWithGemini, generateSlugFromGemini } from '@/lib/api/gemini'
import { materializeBoundMaterialsForPrompt } from '@/lib/draftMaterialsContext'
import { generateArticleEyecatch } from '@/lib/articleImage'
import { pickAutoArticleImage } from '@/lib/autoImagePicker'
import { postToWordPress, getWordPressConfig } from '@/lib/wordpress'
import { saveArticleToS3 } from '@/lib/articleServerStorage'
import { upsertArticleEmbedding } from '@/lib/articleEmbeddings'
import { decodeHtmlEntities, type WpTagListItem } from '@/lib/wpTagList'
import {
  selectAutoKeyword,
  slotForWeekday,
  AUTO_SLOT_LABELS,
  type AutoSlot,
} from '@/lib/autoKwSelector'
import {
  loadAutoArticleLog,
  appendAutoArticleLog,
  hasScheduledEntryForDate,
  recentKeywordsFromLog,
} from '@/lib/autoArticleLog'
import { loadAutoArticleSettings } from '@/lib/autoArticleSettings'
import type { SavedArticle } from '@/lib/types'

export const dynamic = 'force-dynamic'
/** 一次執筆＋推敲＋画像生成＋WP投稿の合計。Pro プランで 300 秒まで利用可能 */
export const maxDuration = 300

/** 自動投稿の開始日（この日以降の月水金に予約投稿する） */
const START_DATE = '2026-07-15'
/** 公開時刻（JST） */
const PUBLISH_TIME_JST = '09:00:00'

/** JSTの「今」を表す Date（UTCゲッターでJST値が取れるようにシフト済み） */
function nowJst(): Date {
  return new Date(Date.now() + 9 * 3600000)
}

function formatDateJst(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 既存WPタグのうちタイトル・KWに含まれるものを最大3件選ぶ（自動タグ付け） */
async function pickMatchingWpTags(title: string, keyword: string): Promise<string[]> {
  const config = getWordPressConfig()
  if (!config) return []
  try {
    const url = `${config.wpUrl}/wp-json/wp/v2/tags?per_page=100&orderby=count&order=desc&_fields=id,name,count`
    const res = await fetch(url, {
      headers: { Authorization: config.authorization, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const rows = (await res.json()) as WpTagListItem[]
    const haystack = `${title} ${keyword}`.toLowerCase()
    return rows
      .map(t => decodeHtmlEntities(String(t.name ?? '')))
      .filter(name => name.length >= 2 && haystack.includes(name.toLowerCase()))
      .slice(0, 3)
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  // セキュリティチェック: CRON_SECRET が設定されている場合は検証
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (cronSecret) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: '認証エラー' }, { status: 401 })
    }
  }

  if (process.env.AUTO_ARTICLE_DISABLED === '1') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'AUTO_ARTICLE_DISABLED=1' })
  }

  // 注意書きページのボタンからOFFにされている場合はスキップ
  const settings = await loadAutoArticleSettings()
  if (!settings.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: '自動生成が設定でOFFになっています（投稿スケジュール・注意書きページから変更可能）' })
  }

  const { searchParams } = new URL(request.url)
  const force = searchParams.get('force') === '1'

  // ── 1. 投稿日の判定（デフォルト: JSTの翌日） ──────────────
  let publishDate: string
  const dateParam = searchParams.get('date')
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    publishDate = dateParam
  } else {
    const tomorrow = nowJst()
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    publishDate = formatDateJst(tomorrow)
  }

  const publishDow = new Date(`${publishDate}T00:00:00Z`).getUTCDay()
  const slot: AutoSlot | null = slotForWeekday(publishDow)

  if (!force) {
    // 期間は設定（投稿スケジュールページ）を優先し、未設定時はシステム既定の開始日
    const effectiveStart = settings.startDate ?? START_DATE
    if (publishDate < effectiveStart) {
      return NextResponse.json({ ok: true, skipped: true, reason: `開始日前（${effectiveStart}開始）`, publishDate })
    }
    if (settings.endDate && publishDate > settings.endDate) {
      return NextResponse.json({ ok: true, skipped: true, reason: `自動投稿期間の終了日（${settings.endDate}）を過ぎています`, publishDate })
    }
    if (!slot) {
      return NextResponse.json({ ok: true, skipped: true, reason: '投稿日（月水金）ではありません', publishDate })
    }
  }

  const effectiveSlot: AutoSlot = slot ?? 'opportunity'

  try {
    // ── 2. 二重生成防止 ──────────────────────────────────
    const log = await loadAutoArticleLog()
    if (!force && hasScheduledEntryForDate(log, publishDate)) {
      return NextResponse.json({ ok: true, skipped: true, reason: '既にこの投稿日の記事が予約済みです', publishDate })
    }

    // ── 3. KW選定 ────────────────────────────────────────
    const excludeKeywords = recentKeywordsFromLog(log, 90)
    const selection = await selectAutoKeyword(effectiveSlot, { excludeKeywords })
    if (!selection) {
      await appendAutoArticleLog(log, {
        publishDate,
        slot: effectiveSlot,
        keyword: '',
        reason: '候補なし',
        status: 'failed',
        error: 'KW候補が見つかりませんでした',
        createdAt: new Date().toISOString(),
      })
      return NextResponse.json({ ok: false, error: 'KW候補が見つかりませんでした', publishDate }, { status: 500 })
    }

    console.log(`[AutoArticle] ${publishDate} ${AUTO_SLOT_LABELS[effectiveSlot]} KW="${selection.keyword}" — ${selection.reason}`)

    // ── 4. 一次執筆（RAG） ────────────────────────────────
    const draft = await generateDraftArticle({
      prompt: selection.prompt,
      targetKeyword: selection.keyword,
    })

    // ── 5. AI推敲 + スラッグ生成 ──────────────────────────
    const referenceMaterialsContext = draft.materialBinding
      ? await materializeBoundMaterialsForPrompt(draft.materialBinding)
      : null
    const { refinedTitle, refinedContent } = await refineArticleWithGemini(
      draft.title,
      draft.content,
      selection.keyword,
      referenceMaterialsContext ?? undefined,
    )
    const finalTitle = refinedTitle || draft.title
    const finalContent = refinedContent
    const slug = await generateSlugFromGemini(finalTitle, selection.keyword, finalContent)

    // ── 6. アイキャッチ選定（画像ライブラリからランダム） ────
    // ルール: 直前の投稿と同じ画像は禁止・同一週（月〜日）内の再使用も禁止。
    // ライブラリが空の場合のみAI生成にフォールバック。失敗しても投稿は続行。
    let imageBase64: string | undefined
    let imageMimeType: string | undefined
    let imageId: string | undefined
    let articleImageUrl = ''
    try {
      const picked = await pickAutoArticleImage(publishDate, log)
      if (picked) {
        imageBase64 = picked.imageBase64
        imageMimeType = picked.mimeType
        imageId = picked.id
        articleImageUrl = picked.appUrl
        console.log(`[AutoArticle] 画像ライブラリから選定: ${picked.id}`)
      } else {
        console.warn('[AutoArticle] 画像ライブラリが空のためAI生成にフォールバック')
        const eyecatch = await generateArticleEyecatch(finalTitle, finalContent, selection.keyword)
        imageBase64 = eyecatch.imageBase64
        imageMimeType = eyecatch.mimeType
        articleImageUrl = `data:${eyecatch.mimeType};base64,${eyecatch.imageBase64}`
      }
    } catch (e) {
      console.warn('[AutoArticle] アイキャッチ選定に失敗（画像なしで投稿続行）:', e)
    }

    // ── 7. タグ決定 ──────────────────────────────────────
    let wordpressTags: string[] = []
    if (selection.gapTag) {
      wordpressTags = [selection.gapTag.tagName]
    } else {
      wordpressTags = await pickMatchingWpTags(finalTitle, selection.keyword)
    }

    // ── 8. WordPress 予約投稿 ─────────────────────────────
    const scheduledDateTime = `${publishDate}T${PUBLISH_TIME_JST}`
    const wpResult = await postToWordPress(
      {
        title: finalTitle,
        content: finalContent,
        targetKeyword: selection.keyword,
        imageBase64,
        imageBase64MimeType: imageMimeType,
        slug,
        wordpressTags: wordpressTags.length > 0 ? wordpressTags : undefined,
      },
      'future',
      { scheduledDate: scheduledDateTime },
    )

    // ── 9. 記事をS3に保存 + embedding 更新 ────────────────
    const articleId = String(Date.now())
    const article: SavedArticle = {
      id: articleId,
      title: draft.title,
      refinedTitle: finalTitle,
      targetKeyword: selection.keyword,
      originalContent: draft.content,
      refinedContent: finalContent,
      imageUrl: articleImageUrl,
      wordpressUrl: wpResult.link,
      status: 'published',
      createdAt: new Date().toISOString(),
      scheduledDate: publishDate,
      scheduledTime: PUBLISH_TIME_JST.slice(0, 5),
      wordpressPostStatus: wpResult.status,
      wordpressPublishedAt: wpResult.dateGmt,
      slug,
      wordpressTags: wordpressTags.length > 0 ? wordpressTags : undefined,
      wordCount: finalContent.length,
    }
    const saved = await saveArticleToS3(article)
    if (!saved) {
      console.error('[AutoArticle] 記事のS3保存に失敗（WP予約投稿は成功済み）')
    } else {
      try {
        await upsertArticleEmbedding(article)
      } catch (e) {
        console.warn('[AutoArticle] embedding 更新に失敗:', e)
      }
    }

    // ── 10. ログ記録 ─────────────────────────────────────
    await appendAutoArticleLog(log, {
      publishDate,
      slot: effectiveSlot,
      keyword: selection.keyword,
      reason: selection.reason,
      articleId,
      wpPostId: wpResult.id,
      wpUrl: wpResult.link,
      imageId,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
    })

    console.log(`[AutoArticle] 完了: "${finalTitle}" → ${wpResult.link}（${publishDate} ${PUBLISH_TIME_JST} 公開予約）`)
    return NextResponse.json({
      ok: true,
      publishDate,
      slot: effectiveSlot,
      keyword: selection.keyword,
      reason: selection.reason,
      title: finalTitle,
      wpPostId: wpResult.id,
      wpUrl: wpResult.link,
      editUrl: wpResult.editLink,
      hasImage: Boolean(imageBase64),
      imageId: imageId ?? null,
      tags: wordpressTags,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : '不明なエラー'
    console.error('[AutoArticle] エラー:', e)
    try {
      const log = await loadAutoArticleLog()
      await appendAutoArticleLog(log, {
        publishDate,
        slot: effectiveSlot,
        keyword: '',
        reason: '',
        status: 'failed',
        error: message,
        createdAt: new Date().toISOString(),
      })
    } catch { /* ログ失敗は握りつぶす */ }
    return NextResponse.json({ ok: false, error: message, publishDate }, { status: 500 })
  }
}
