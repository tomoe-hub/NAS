/**
 * 総合分析（サイト診断）のコアロジック（サーバー専用）。
 *
 * 対象ページのHTMLを取得して技術面（タイトル・メタ・見出し・alt・リンク等）を
 * 機械チェックし、S3のGSC/GA4実測値を紐付けたうえで Bedrock Claude が
 * ページ単位の課題と打ち手を診断する。全ページ分の診断が揃ったら
 * サイト全体の総合サマリも生成できる。
 *
 * 結果は S3（site-audit/results.json）に保存し、ページ単位で上書き更新する。
 * Vercelの実行時間制限を避けるため、診断は「1リクエスト=1ページ」で行い、
 * フロント側が選択ページを順番に処理する設計。
 */

import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import { generateWithClaude } from '@/lib/api/claude'
import { loadGscRows, loadGa4Rows } from '@/lib/seo/seoStore'

const RESULTS_KEY = 'site-audit/results.json'

/** 診断対象として許可するドメイン（SSRF対策） */
const ALLOWED_HOST_SUFFIXES = ['nihon-teikei.co.jp', 'nihon-teikei.com']

/** 診断対象ページのプリセット（ユーザー提供のサイト構成） */
export const DEFAULT_AUDIT_PAGES: { url: string; label: string }[] = [
  { url: 'https://nihon-teikei.co.jp/', label: 'トップページ' },
  { url: 'https://nihon-teikei.co.jp/about/', label: '日本提携支援について' },
  { url: 'https://nihon-teikei.co.jp/service/', label: '事業内容ページ' },
  { url: 'https://nihon-teikei.co.jp/news/casestudy/', label: '導入事例ページ' },
  { url: 'https://nihon-teikei.co.jp/news/column/', label: '記事ページ' },
  { url: 'https://nihon-teikei.co.jp/whitepaper/', label: 'ホワイトペーパーページ' },
  { url: 'https://nihon-teikei.co.jp/news/', label: 'ニュースページ' },
  { url: 'https://nihon-teikei.com/intern/', label: '採用ページ' },
  { url: 'https://nihon-teikei.co.jp/ma-newstandard/', label: 'ニュースタンダードページ' },
  { url: 'https://subsidy.nihon-teikei.co.jp/', label: '補助金LP' },
  { url: 'https://subsidy.nihon-teikei.co.jp/subsidies', label: '補助金プラットフォームページ' },
]

/* ── 型 ── */

export interface PageTechAudit {
  httpStatus: number
  title: string
  titleLength: number
  metaDescription: string
  metaDescriptionLength: number
  h1Texts: string[]
  h2Count: number
  h3Count: number
  /** 見出しアウトライン（H1〜H3、最大30件） */
  headingOutline: string[]
  /** 本文テキスト文字数（タグ除去後） */
  textLength: number
  imagesTotal: number
  imagesMissingAlt: number
  internalLinks: number
  externalLinks: number
  canonicalUrl: string
  hasOgp: boolean
  structuredDataTypes: string[]
  isNoindex: boolean
}

export type AuditPriority = 'high' | 'medium' | 'low'

export interface PageAuditAi {
  /** 0-100 の総合スコア */
  score: number
  summary: string
  issues: string[]
  actions: { title: string; description: string; priority: AuditPriority }[]
}

export interface PageGscStats {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface PageGa4Stats {
  sessions: number
  pageViews: number
  engagementRate: number
}

export interface PageAuditResult {
  url: string
  label: string
  generatedAt: string
  tech: PageTechAudit
  gsc?: PageGscStats
  ga4?: PageGa4Stats
  ai: PageAuditAi | null
}

export interface SiteAuditOverall {
  generatedAt: string
  summary: string
  issues: string[]
  actions: { title: string; description: string; priority: AuditPriority; category: string }[]
}

export interface SiteAuditDocument {
  updatedAt: string
  /** URL → 診断結果 */
  pages: Record<string, PageAuditResult>
  overall?: SiteAuditOverall
}

/* ── S3 ── */

export async function loadSiteAuditDocument(): Promise<SiteAuditDocument> {
  const obj = await getS3ObjectAsText(RESULTS_KEY)
  if (!obj) return { updatedAt: '', pages: {} }
  try {
    const parsed = JSON.parse(obj.content) as SiteAuditDocument
    return { updatedAt: parsed.updatedAt ?? '', pages: parsed.pages ?? {}, overall: parsed.overall }
  } catch {
    return { updatedAt: '', pages: {} }
  }
}

async function saveSiteAuditDocument(doc: SiteAuditDocument): Promise<void> {
  const ok = await putS3Object(RESULTS_KEY, JSON.stringify(doc, null, 2))
  if (!ok) throw new Error('診断結果のS3保存に失敗しました')
}

/* ── URL検証 ── */

export function isAllowedAuditUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    return ALLOWED_HOST_SUFFIXES.some(s => u.hostname === s || u.hostname.endsWith(`.${s}`))
  } catch {
    return false
  }
}

/* ── HTML解析（正規表現ベース） ── */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function attrValue(tag: string, attr: string): string {
  const m = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return m ? m[1] : ''
}

/** <meta name/property=xxx content=...> を取得 */
function metaContent(html: string, key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const name = (attrValue(tag, 'name') || attrValue(tag, 'property')).toLowerCase()
    if (name === key.toLowerCase()) return decodeEntities(attrValue(tag, 'content'))
  }
  return ''
}

function headingTexts(html: string, level: 1 | 2 | 3): string[] {
  const re = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1])
    if (text) out.push(text)
  }
  return out
}

function parseHtml(html: string, pageUrl: string, httpStatus: number): { tech: PageTechAudit; textExcerpt: string } {
  // script/style/noscript を除去した本文用HTML
  const bodyHtml = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? stripTags(titleMatch[1]) : ''
  const metaDescription = metaContent(html, 'description')

  const h1Texts = headingTexts(bodyHtml, 1)
  const h2Texts = headingTexts(bodyHtml, 2)
  const h3Texts = headingTexts(bodyHtml, 3)
  const headingOutline: string[] = [
    ...h1Texts.map(t => `H1: ${t}`),
    ...h2Texts.map(t => `H2: ${t}`),
    ...h3Texts.map(t => `H3: ${t}`),
  ].slice(0, 30)

  const text = stripTags(bodyHtml)

  // 画像とalt
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? []
  let imagesMissingAlt = 0
  for (const tag of imgTags) {
    const alt = attrValue(tag, 'alt').trim()
    if (!alt) imagesMissingAlt++
  }

  // リンク（内部/外部）
  const host = new URL(pageUrl).hostname
  const aTags = html.match(/<a\b[^>]*>/gi) ?? []
  let internalLinks = 0
  let externalLinks = 0
  for (const tag of aTags) {
    const href = attrValue(tag, 'href')
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue
    try {
      const u = new URL(href, pageUrl)
      if (u.hostname === host) internalLinks++
      else externalLinks++
    } catch {
      /* 不正hrefは無視 */
    }
  }

  // canonical
  let canonicalUrl = ''
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? []
  for (const tag of linkTags) {
    if (attrValue(tag, 'rel').toLowerCase() === 'canonical') {
      canonicalUrl = attrValue(tag, 'href')
      break
    }
  }

  // OGP / noindex
  const hasOgp = Boolean(metaContent(html, 'og:title') || metaContent(html, 'og:description'))
  const isNoindex = metaContent(html, 'robots').toLowerCase().includes('noindex')

  // 構造化データ（JSON-LD の @type）
  const structuredDataTypes: string[] = []
  const ldMatches = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const block of ldMatches) {
    const inner = block.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '')
    try {
      const parsed = JSON.parse(inner)
      const items = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of items) {
        const t = item?.['@type']
        if (typeof t === 'string') structuredDataTypes.push(t)
        else if (Array.isArray(t)) structuredDataTypes.push(...t.filter((x: unknown): x is string => typeof x === 'string'))
      }
    } catch {
      /* 壊れたJSON-LDは無視 */
    }
  }

  const tech: PageTechAudit = {
    httpStatus,
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    h1Texts,
    h2Count: h2Texts.length,
    h3Count: h3Texts.length,
    headingOutline,
    textLength: text.length,
    imagesTotal: imgTags.length,
    imagesMissingAlt,
    internalLinks,
    externalLinks,
    canonicalUrl,
    hasOgp,
    structuredDataTypes: [...new Set(structuredDataTypes)].slice(0, 10),
    isNoindex,
  }

  return { tech, textExcerpt: text.slice(0, 2500) }
}

/* ── GSC/GA4 実測値の紐付け ── */

function normUrl(u: string): string {
  return u.replace(/\/+$/, '')
}

const METRICS_WINDOW_DAYS = 28

async function loadPageMetrics(pageUrl: string): Promise<{ gsc?: PageGscStats; ga4?: PageGa4Stats }> {
  const cutoff = new Date(Date.now() - METRICS_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const target = normUrl(pageUrl)
  const result: { gsc?: PageGscStats; ga4?: PageGa4Stats } = {}

  try {
    const gscRows = await loadGscRows()
    let clicks = 0
    let impressions = 0
    let weightedPos = 0
    for (const r of gscRows) {
      if (r.rowType !== 'query' && r.rowType !== undefined) continue
      if (!r.page || r.date < cutoff) continue
      if (normUrl(r.page) !== target) continue
      clicks += r.clicks
      impressions += r.impressions
      weightedPos += r.position * (r.impressions || 0)
    }
    if (impressions > 0 || clicks > 0) {
      result.gsc = {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: impressions > 0 ? weightedPos / impressions : 0,
      }
    }
  } catch (e) {
    console.warn('[SiteAudit] GSC実測値の取得失敗:', e)
  }

  try {
    const pathName = new URL(pageUrl).pathname.replace(/\/+$/, '') || '/'
    const ga4Rows = await loadGa4Rows()
    let sessions = 0
    let pageViews = 0
    let engWeighted = 0
    for (const r of ga4Rows) {
      if (r.rowType !== 'main' || !r.pagePath || r.date < cutoff) continue
      const p = r.pagePath.replace(/\/+$/, '') || '/'
      if (p !== pathName) continue
      sessions += r.sessions
      pageViews += r.pageViews
      engWeighted += (r.engagementRate ?? 0) * r.sessions
    }
    if (sessions > 0 || pageViews > 0) {
      result.ga4 = {
        sessions,
        pageViews,
        engagementRate: sessions > 0 ? engWeighted / sessions : 0,
      }
    }
  } catch (e) {
    console.warn('[SiteAudit] GA4実測値の取得失敗:', e)
  }

  return result
}

/* ── Claude 診断 ── */

function extractJson(text: string): string {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI応答からJSONを抽出できませんでした')
  }
  return cleaned.slice(start, end + 1)
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

function buildPagePrompt(
  label: string,
  url: string,
  tech: PageTechAudit,
  metrics: { gsc?: PageGscStats; ga4?: PageGa4Stats },
  textExcerpt: string,
): string {
  const techLines = [
    `- HTTPステータス: ${tech.httpStatus}`,
    `- タイトル: 「${tech.title}」（${tech.titleLength}文字）`,
    `- メタディスクリプション: ${tech.metaDescription ? `「${tech.metaDescription}」（${tech.metaDescriptionLength}文字）` : '未設定'}`,
    `- H1: ${tech.h1Texts.length}個 ${tech.h1Texts.length > 0 ? `（${tech.h1Texts.join(' / ')}）` : ''}`,
    `- 見出し数: H2=${tech.h2Count} H3=${tech.h3Count}`,
    `- 本文テキスト量: 約${tech.textLength}文字`,
    `- 画像: ${tech.imagesTotal}枚（alt未設定 ${tech.imagesMissingAlt}枚）`,
    `- リンク: 内部${tech.internalLinks} / 外部${tech.externalLinks}`,
    `- canonical: ${tech.canonicalUrl || '未設定'}`,
    `- OGP: ${tech.hasOgp ? 'あり' : 'なし'} / 構造化データ: ${tech.structuredDataTypes.length > 0 ? tech.structuredDataTypes.join(', ') : 'なし'}`,
    `- noindex: ${tech.isNoindex ? '設定あり（要確認）' : 'なし'}`,
  ].join('\n')

  const outline = tech.headingOutline.length > 0 ? tech.headingOutline.map(h => `- ${h}`).join('\n') : '（見出しなし）'

  const metricsLines: string[] = []
  if (metrics.gsc) {
    metricsLines.push(`- GSC直近28日: クリック${metrics.gsc.clicks} / 表示${metrics.gsc.impressions} / CTR ${pct(metrics.gsc.ctr)} / 平均順位 ${metrics.gsc.position.toFixed(1)}`)
  }
  if (metrics.ga4) {
    metricsLines.push(`- GA4直近28日: セッション${metrics.ga4.sessions} / PV ${metrics.ga4.pageViews} / エンゲージメント率 ${pct(metrics.ga4.engagementRate)}`)
  }
  const metricsSection = metricsLines.length > 0 ? metricsLines.join('\n') : '（このページの実測データはまだ蓄積されていません）'

  return `あなたは日本のM&A・業務提携仲介会社「日本提携支援」のWebサイトを診断するシニアSEO/CROコンサルタントです。
以下の1ページを診断し、SEO・コンテンツ品質・問い合わせ（CV）導線の観点から課題と打ち手をまとめてください。

# 診断対象
- ページ: ${label}
- URL: ${url}

# 技術チェック結果（機械判定）
${techLines}

# 見出しアウトライン
${outline}

# 実測データ
${metricsSection}

# 本文テキスト（先頭2500文字）
${textExcerpt || '（本文テキストを取得できませんでした）'}

# 出力ルール
- 必ず次のJSONスキーマに厳密に従い、JSON以外のテキストを一切出力しないこと
- score はSEO・コンテンツ・CV導線を総合した0〜100の整数。技術的な欠落（メタ未設定・H1欠落・noindex等）は減点し、良好なら80以上も可
- 課題・打ち手はこのページ固有の内容に踏み込むこと（一般論だけで終わらせない）
- 断定できない点は「〜の可能性がある」と仮説の表現を使うこと
- issues は2〜6個、actions は2〜5個。文字列は簡潔に（description は2〜3文まで）

# JSONスキーマ
{
  "score": 75,
  "summary": "このページの総評（2〜3文）",
  "issues": ["課題1", "課題2"],
  "actions": [
    { "title": "打ち手（20字以内目安）", "description": "具体的にどうするか（2〜3文）", "priority": "high | medium | low" }
  ]
}`
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, max)
}

function normalizePriority(v: unknown): AuditPriority {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'medium'
}

function normalizePageAi(parsed: Record<string, unknown>): PageAuditAi {
  const rawScore = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score)
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
        .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
        .map(a => ({
          title: typeof a.title === 'string' ? a.title : '',
          description: typeof a.description === 'string' ? a.description : '',
          priority: normalizePriority(a.priority),
        }))
        .filter(a => a.title && a.description)
        .slice(0, 6)
    : []
  return {
    score: Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    issues: asStringArray(parsed.issues, 8),
    actions,
  }
}

async function generateJsonWithRetry(prompt: string, maxTokens: number): Promise<Record<string, unknown>> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await generateWithClaude(prompt, { maxTokens, temperature: 0.4 })
      return JSON.parse(extractJson(raw)) as Record<string, unknown>
    } catch (e) {
      lastError = e
      console.warn(`[SiteAudit] AI生成/パース失敗 (attempt ${attempt}):`, e)
    }
  }
  throw new Error(`AI診断の生成に失敗しました: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

/* ── 公開API: 1ページ診断 ── */

export async function auditPage(url: string, label: string): Promise<PageAuditResult> {
  if (!isAllowedAuditUrl(url)) {
    throw new Error('診断できるのは nihon-teikei.co.jp / nihon-teikei.com 配下のURLのみです')
  }

  // 1. HTML取得
  let httpStatus = 0
  let html = ''
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NAS-SiteAudit/1.0; +https://nihon-teikei.co.jp/)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      cache: 'no-store',
    })
    httpStatus = res.status
    html = await res.text()
  } catch (e) {
    throw new Error(`ページの取得に失敗しました（${url}）: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 2. 技術チェック＋実測値
  const { tech, textExcerpt } = parseHtml(html, url, httpStatus)
  const metrics = await loadPageMetrics(url)

  // 3. AI診断
  let ai: PageAuditAi | null = null
  const parsed = await generateJsonWithRetry(buildPagePrompt(label, url, tech, metrics, textExcerpt), 6000)
  ai = normalizePageAi(parsed)
  if (!ai.summary || ai.actions.length === 0) {
    throw new Error('AI診断の応答が不完全でした。もう一度お試しください。')
  }

  const result: PageAuditResult = {
    url,
    label,
    generatedAt: new Date().toISOString(),
    tech,
    ...(metrics.gsc ? { gsc: metrics.gsc } : {}),
    ...(metrics.ga4 ? { ga4: metrics.ga4 } : {}),
    ai,
  }

  // 4. 保存（ページ単位でupsert）
  const doc = await loadSiteAuditDocument()
  doc.pages[url] = result
  doc.updatedAt = result.generatedAt
  await saveSiteAuditDocument(doc)

  return result
}

/* ── 公開API: 総合サマリ生成 ── */

function buildOverallPrompt(pages: PageAuditResult[]): string {
  const pageSections = pages
    .map(p => {
      const lines = [
        `## ${p.label}（${p.url}）スコア: ${p.ai?.score ?? '-'} /100`,
        `- 総評: ${p.ai?.summary ?? '-'}`,
        `- 主な課題: ${(p.ai?.issues ?? []).slice(0, 3).join(' ／ ') || '-'}`,
        `- 技術: タイトル${p.tech.titleLength}字 / メタ${p.tech.metaDescriptionLength > 0 ? `${p.tech.metaDescriptionLength}字` : '未設定'} / H1=${p.tech.h1Texts.length} / alt未設定${p.tech.imagesMissingAlt} / 内部リンク${p.tech.internalLinks}${p.tech.isNoindex ? ' / ⚠noindex' : ''}`,
      ]
      if (p.gsc) lines.push(`- GSC: クリック${p.gsc.clicks} / 表示${p.gsc.impressions} / 平均順位${p.gsc.position.toFixed(1)}`)
      return lines.join('\n')
    })
    .join('\n\n')

  return `あなたは日本のM&A・業務提携仲介会社「日本提携支援」のWebサイト全体を診断するシニアSEO/CROコンサルタントです。
以下は主要ページごとの診断結果です。これを踏まえ、サイト全体としての現状・横断的な課題・優先度付きの打ち手をまとめてください。

# ページ別診断結果

${pageSections}

# 出力ルール
- 必ず次のJSONスキーマに厳密に従い、JSON以外のテキストを一切出力しないこと
- サイト横断の視点（ページ間の導線・役割分担・内部リンク・CVまでの流れ・ドメイン分散など）を重視すること
- 断定できない点は仮説の表現を使うこと
- issues は3〜6個、actions は3〜6個。summary は3〜5文

# JSONスキーマ
{
  "summary": "サイト全体の総評（3〜5文）",
  "issues": ["横断課題1", "横断課題2"],
  "actions": [
    { "title": "打ち手（20字以内目安）", "description": "具体的にどうするか（2〜3文）", "priority": "high | medium | low", "category": "SEO | CV導線 | コンテンツ | サイト構造 | その他 のいずれか" }
  ]
}`
}

export async function generateSiteAuditOverall(): Promise<SiteAuditOverall> {
  const doc = await loadSiteAuditDocument()
  const pages = Object.values(doc.pages).filter(p => p.ai)
  if (pages.length === 0) {
    throw new Error('ページ診断の結果がまだありません。先にページを診断してください。')
  }

  const parsed = await generateJsonWithRetry(buildOverallPrompt(pages), 6000)
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
        .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
        .map(a => ({
          title: typeof a.title === 'string' ? a.title : '',
          description: typeof a.description === 'string' ? a.description : '',
          priority: normalizePriority(a.priority),
          category: typeof a.category === 'string' && a.category ? a.category : 'その他',
        }))
        .filter(a => a.title && a.description)
        .slice(0, 8)
    : []

  const overall: SiteAuditOverall = {
    generatedAt: new Date().toISOString(),
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    issues: asStringArray(parsed.issues, 8),
    actions,
  }
  if (!overall.summary || overall.actions.length === 0) {
    throw new Error('総合サマリの応答が不完全でした。もう一度お試しください。')
  }

  doc.overall = overall
  doc.updatedAt = overall.generatedAt
  await saveSiteAuditDocument(doc)
  return overall
}
