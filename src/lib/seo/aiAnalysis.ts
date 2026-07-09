/**
 * SEO分析ページの「AI分析」機能（サーバー専用）。
 *
 * S3に蓄積した GA4/GSC/Clarity のメトリクスに加え、記事一覧・自動投稿ログを
 * Bedrock Claude に渡し、「現状サマリ→良い点→課題→打ち手」を構造化JSONで
 * 生成して S3（seo-metrics/ai-analysis.json）に保存する。
 *
 * データが薄い段階では示唆が一般論に寄るため、プロンプトで
 * 「データ量の限界を dataCaveats に明記し、断定を避ける」よう指示している。
 */

import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import { generateWithClaude } from '@/lib/api/claude'
import { getArticleSummaries } from '@/lib/articleServerStorage'
import { loadAutoArticleLog } from '@/lib/autoArticleLog'
import { buildSeoDashboardData, type SeoDashboardData } from './aggregate'
import { rangeKeyOrDefault, type RangeKey } from './dateRange'

const REPORT_KEY = 'seo-metrics/ai-analysis.json'
const HISTORY_KEY = 'seo-metrics/ai-analysis-history.json'

/** 履歴として保持するレポートの最大数 */
const MAX_HISTORY_REPORTS = 20

export type SeoAiActionPriority = 'high' | 'medium' | 'low'

export interface SeoAiAction {
  title: string
  description: string
  priority: SeoAiActionPriority
  /** 例: リライト / 新規記事 / サイト改善 / 計測 など */
  category: string
}

export interface SeoAiReport {
  generatedAt: string
  range: RangeKey
  /** 分析対象期間（例: 2026-06-11 〜 2026-07-08） */
  periodLabel: string
  /** 現状サマリ（3〜5文） */
  summary: string
  strengths: string[]
  issues: string[]
  actions: SeoAiAction[]
  /** データの限界・読み方の注意 */
  dataCaveats: string[]
}

export async function loadSeoAiReport(): Promise<SeoAiReport | null> {
  const obj = await getS3ObjectAsText(REPORT_KEY)
  if (!obj) return null
  try {
    const parsed = JSON.parse(obj.content) as SeoAiReport
    return parsed?.generatedAt ? parsed : null
  } catch {
    return null
  }
}

/** 過去のAI分析レポート一覧（新しい順） */
export async function loadSeoAiHistory(): Promise<SeoAiReport[]> {
  const obj = await getS3ObjectAsText(HISTORY_KEY)
  if (!obj) return []
  try {
    const parsed = JSON.parse(obj.content)
    return Array.isArray(parsed) ? (parsed as SeoAiReport[]) : []
  } catch {
    return []
  }
}

function jstDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10)
}

/** レポートを履歴に日付単位で保存（同日の再分析は上書き） */
async function appendToHistory(report: SeoAiReport): Promise<void> {
  try {
    const history = await loadSeoAiHistory()
    const date = jstDateOf(report.generatedAt)
    const next = [report, ...history.filter(h => jstDateOf(h.generatedAt) !== date)]
      .sort((a, b) => (a.generatedAt < b.generatedAt ? 1 : -1))
      .slice(0, MAX_HISTORY_REPORTS)
    await putS3Object(HISTORY_KEY, JSON.stringify(next))
  } catch (e) {
    console.warn('[SEO AI] 履歴保存失敗:', e)
  }
}

/* ── 入力データの整形 ── */

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function line(items: Array<string | number>): string {
  return items.join(' | ')
}

function buildMetricsSection(data: SeoDashboardData): string {
  const { kpi, window } = data
  const c = kpi.current
  const p = kpi.previous
  const ch = kpi.change

  const parts: string[] = []
  parts.push(`## 対象期間: ${window.start} 〜 ${window.end}（前期間: ${window.prevStart} 〜 ${window.prevEnd}）`)
  parts.push('')
  parts.push('## KPI（当期 / 前期 / 変化）')
  parts.push(`- GA4セッション: ${c.sessions} / ${p.sessions} / ${ch.sessions.toFixed(1)}%`)
  parts.push(`- GA4ユーザー: ${c.users} / ${p.users} / ${ch.users.toFixed(1)}%`)
  parts.push(`- GA4新規ユーザー: ${c.newUsers} / ${p.newUsers} / ${ch.newUsers.toFixed(1)}%`)
  parts.push(`- GA4ページビュー: ${c.pageViews} / ${p.pageViews} / ${ch.pageViews.toFixed(1)}%`)
  parts.push(`- GA4コンバージョン: ${c.conversions} / ${p.conversions} / ${ch.conversions.toFixed(1)}%`)
  parts.push(`- GA4エンゲージメント率: ${pct(c.engagementRate)} / ${pct(p.engagementRate)}`)
  parts.push(`- GSC表示回数: ${c.impressions} / ${p.impressions} / ${ch.impressions.toFixed(1)}%`)
  parts.push(`- GSCクリック: ${c.clicks} / ${p.clicks} / ${ch.clicks.toFixed(1)}%`)
  parts.push(`- GSC CTR: ${pct(c.ctr)} / ${pct(p.ctr)}`)
  parts.push(`- GSC平均掲載順位: ${c.avgPosition.toFixed(1)} / ${p.avgPosition.toFixed(1)}`)

  if (data.channelMix.length > 0) {
    parts.push('')
    parts.push('## チャネル構成（GA4: チャネル | セッション | シェア | CV）')
    for (const ck of data.channelMix.slice(0, 8)) {
      parts.push(`- ${line([ck.name, ck.sessions, `${ck.share}%`, ck.conversions])}`)
    }
  }

  if (data.topQueries.length > 0) {
    parts.push('')
    parts.push('## GSC上位クエリ（クエリ | クリック | 表示 | CTR | 平均順位）')
    for (const q of data.topQueries.slice(0, 15)) {
      parts.push(`- ${line([q.query, q.clicks, q.impressions, pct(q.ctr), q.position.toFixed(1)])}`)
    }
  }

  if (data.topPagesGsc.length > 0) {
    parts.push('')
    parts.push('## GSC上位ページ（URL | クリック | 表示 | CTR | 平均順位）')
    for (const pg of data.topPagesGsc.slice(0, 10)) {
      parts.push(`- ${line([pg.page, pg.clicks, pg.impressions, pct(pg.ctr), pg.position.toFixed(1)])}`)
    }
  }

  if (data.topPagesGa4.length > 0) {
    parts.push('')
    parts.push('## GA4上位ページ（パス | セッション | PV | エンゲージメント率）')
    for (const pg of data.topPagesGa4.slice(0, 10)) {
      parts.push(`- ${line([pg.pagePath, pg.sessions, pg.pageViews, pct(pg.engagementRate)])}`)
    }
  }

  if (data.gscDevices.length > 0) {
    parts.push('')
    parts.push('## GSCデバイス別（デバイス | クリック | 表示 | CTR）')
    for (const d of data.gscDevices) {
      parts.push(`- ${line([d.device, d.clicks, d.impressions, pct(d.ctr)])}`)
    }
  }

  if (data.clarity) {
    const ux = data.clarity.ux
    parts.push('')
    parts.push(`## Clarity UX（直近${ux.windowDays}日スナップショット: ${ux.snapshotDate}）`)
    parts.push(`- セッション: ${ux.sessions} / ユーザー: ${ux.distinctUsers} / ページ/セッション: ${ux.pagesPerSession.toFixed(1)}`)
    parts.push(`- スクロール深度: ${ux.scrollDepth.toFixed(1)}% / エンゲージメント時間: ${ux.engagementTime.toFixed(0)}秒`)
    parts.push(`- デッドクリック: ${ux.deadClickCount}（率 ${pct(ux.deadClickRate)}） / レイジクリック: ${ux.rageClickCount}（率 ${pct(ux.rageClickRate)}）`)
    parts.push(`- スクリプトエラー: ${ux.scriptErrorCount} / クイックバック: ${ux.quickbackCount} / UXスコア: ${ux.score}/100`)
    if (data.clarity.topPages.length > 0) {
      parts.push('### Clarity人気ページ（URL | トラフィック | スクロール深度 | デッド | レイジ）')
      for (const pg of data.clarity.topPages.slice(0, 8)) {
        parts.push(`- ${line([pg.url, pg.traffic, `${pg.scrollDepth.toFixed(0)}%`, pg.deadClickCount, pg.rageClickCount])}`)
      }
    }
  }

  return parts.join('\n')
}

async function buildArticlesSection(): Promise<string> {
  const parts: string[] = []
  try {
    const summaries = await getArticleSummaries()
    const published = summaries.filter(a => a.wordpressPostStatus === 'publish')
    const scheduled = summaries.filter(a => a.wordpressPostStatus === 'future')
    parts.push('## 記事の状況')
    parts.push(`- 保存記事数: ${summaries.length} / WP公開済み: ${published.length} / WP予約中: ${scheduled.length}`)
    const recent = [...summaries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 15)
    if (recent.length > 0) {
      parts.push('### 直近の記事（タイトル | ターゲットKW | WP状態 | 作成日）')
      for (const a of recent) {
        const title = (a.refinedTitle || a.title || '(無題)').slice(0, 60)
        parts.push(`- ${line([title, a.targetKeyword || '-', a.wordpressPostStatus ?? '未送信', a.createdAt.slice(0, 10)])}`)
      }
    }
  } catch (e) {
    console.warn('[SEO AI] 記事サマリー取得失敗:', e)
  }

  try {
    const log = await loadAutoArticleLog()
    if (log.length > 0) {
      const failed = log.filter(e => e.status === 'failed').length
      parts.push('')
      parts.push(`## 自動投稿ログ（全${log.length}件、うち失敗${failed}件）`)
      parts.push('### 直近の自動投稿（公開日 | 枠 | KW | 結果）')
      for (const e of log.slice(-10).reverse()) {
        parts.push(`- ${line([e.publishDate, e.slot, e.keyword, e.status === 'scheduled' ? '予約成功' : `失敗: ${(e.error ?? '').slice(0, 60)}`])}`)
      }
    }
  } catch (e) {
    console.warn('[SEO AI] 自動投稿ログ取得失敗:', e)
  }

  return parts.join('\n')
}

/* ── プロンプト・生成 ── */

function buildPrompt(metricsSection: string, articlesSection: string): string {
  return `あなたは日本のM&A・業務提携仲介会社「日本提携支援」のオウンドメディアを担当するシニアSEOコンサルタントです。
以下の実測データ（GA4 / Google Search Console / Microsoft Clarity / 記事・自動投稿の状況）を分析し、
「現状サマリ → 良い点 → 課題 → 具体的な打ち手」を日本語でまとめてください。

# 分析データ

${metricsSection}

${articlesSection}

# 出力ルール
- 必ず次のJSONスキーマに**厳密に**従い、JSON以外のテキストを一切出力しないこと
- 数値の因果関係は断定せず、「〜の可能性が高い」「〜と考えられる」という仮説の表現を使うこと
- 打ち手（actions）は実行可能な具体策にし、対象のクエリ名・URL・記事名をできる限り明記すること
- データ量が少ない場合はその旨を dataCaveats に明記し、無理に多くの示唆を出さないこと
- strengths / issues は各2〜5個、actions は3〜6個、dataCaveats は1〜3個
- summary は3〜5文。各文字列フィールドは簡潔に（description は2〜3文まで）

# JSONスキーマ
{
  "summary": "現状サマリ（3〜5文）",
  "strengths": ["良い点1", "良い点2"],
  "issues": ["課題1", "課題2"],
  "actions": [
    {
      "title": "打ち手のタイトル（20字以内目安）",
      "description": "何をどうするかの具体的説明（2〜3文）",
      "priority": "high | medium | low のいずれか",
      "category": "リライト | 新規記事 | サイト改善 | 計測・設定 | その他 のいずれか"
    }
  ],
  "dataCaveats": ["データの限界・注意点"]
}`
}

function extractJson(text: string): string {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI応答からJSONを抽出できませんでした')
  }
  return cleaned.slice(start, end + 1)
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, max)
}

function normalizeActions(v: unknown): SeoAiAction[] {
  if (!Array.isArray(v)) return []
  const priorities: SeoAiActionPriority[] = ['high', 'medium', 'low']
  return v
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .map(a => ({
      title: typeof a.title === 'string' ? a.title : '',
      description: typeof a.description === 'string' ? a.description : '',
      priority: priorities.includes(a.priority as SeoAiActionPriority)
        ? (a.priority as SeoAiActionPriority)
        : 'medium',
      category: typeof a.category === 'string' && a.category ? a.category : 'その他',
    }))
    .filter(a => a.title && a.description)
    .slice(0, 8)
}

/**
 * AI分析レポートを生成してS3に保存する。
 */
export async function generateSeoAiReport(rangeRaw: string | null | undefined): Promise<SeoAiReport> {
  const range = rangeKeyOrDefault(rangeRaw)
  const data = await buildSeoDashboardData(range)
  if (!data.hasData) {
    throw new Error('分析対象のSEOデータがまだありません。先に「データ同期」を実行してください。')
  }

  const metricsSection = buildMetricsSection(data)
  const articlesSection = await buildArticlesSection()
  const prompt = buildPrompt(metricsSection, articlesSection)

  let parsed: Record<string, unknown> | null = null
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await generateWithClaude(prompt, { maxTokens: 8000, temperature: 0.4 })
      parsed = JSON.parse(extractJson(raw)) as Record<string, unknown>
      break
    } catch (e) {
      lastError = e
      console.warn(`[SEO AI] 生成/パース失敗 (attempt ${attempt}):`, e)
    }
  }
  if (!parsed) {
    throw new Error(
      `AI分析の生成に失敗しました: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    )
  }

  const report: SeoAiReport = {
    generatedAt: new Date().toISOString(),
    range,
    periodLabel: `${data.window.start} 〜 ${data.window.end}`,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    strengths: asStringArray(parsed.strengths, 6),
    issues: asStringArray(parsed.issues, 6),
    actions: normalizeActions(parsed.actions),
    dataCaveats: asStringArray(parsed.dataCaveats, 4),
  }

  if (!report.summary || report.actions.length === 0) {
    throw new Error('AI分析の応答が不完全でした。もう一度お試しください。')
  }

  const ok = await putS3Object(REPORT_KEY, JSON.stringify(report, null, 2))
  if (!ok) {
    throw new Error('AI分析レポートのS3保存に失敗しました')
  }
  await appendToHistory(report)
  return report
}
