/**
 * 競合分析・戦略提案（サーバー専用）。
 *
 * 競合の公式サイト（Tier 1）をページ単位で収集し、5軸で整理する。
 * Ahrefs のドメイン別オーガニックKWと、自社SEO・サイト診断・ペルソナを組み合わせ、
 * 日本提携支援が取るべき優先施策までを Claude で構造化生成する。
 */

import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import { generateWithClaude } from '@/lib/api/claude'
import { fetchApiUsage, fetchOrganicKeywords } from '@/lib/ahrefsApi'
import { buildSeoDashboardData } from '@/lib/seo/aggregate'
import { loadPersonaDocument } from '@/lib/personaGeneration'
import { loadSiteAuditDocument } from '@/lib/siteAudit'

const CONFIG_KEY = 'competitive-analysis/config.json'
const RESULTS_KEY = 'competitive-analysis/results.json'
const HISTORY_KEY = 'competitive-analysis/history.json'
const MAX_HISTORY = 15
const MAX_SOURCE_CHARS = 8_000

export type CompetitorType = 'direct' | 'indirect'
export type StrategyPriority = 'high' | 'medium' | 'low'
export type StrategyPhase = 'awareness' | 'research' | 'comparison' | 'decision'

export interface CompetitorConfig {
  id: string
  name: string
  domain: string
  type: CompetitorType
  note: string
  urls: CompetitorUrl[]
}

export interface CompetitorUrl {
  url: string
  label: string
}

export interface SourceFact {
  text: string
  sourceUrl: string
  tier: 'Tier1'
  confirmedAt: string
}

export interface CompetitorFiveAxes {
  message: SourceFact[]
  pricing: SourceFact[]
  offering: SourceFact[]
  positioning: SourceFact[]
  authority: SourceFact[]
}

export interface CompetitorPageSource {
  url: string
  label: string
  fetchedAt: string
  httpStatus: number
  title: string
  description: string
  headings: string[]
  textExcerpt: string
}

export interface CompetitorKeyword {
  keyword: string
  volume: number
  position: number | null
  traffic: number | null
  url: string
}

export interface CompetitorResult {
  competitorId: string
  updatedAt: string
  pages: Record<string, CompetitorPageSource>
  axes?: CompetitorFiveAxes
  keywords?: CompetitorKeyword[]
  keywordUpdatedAt?: string
  error?: string
}

export interface KeywordOpportunity {
  keyword: string
  volume: number
  competitors: Array<{ name: string; position: number | null; url: string }>
  selfPosition: number | null
  opportunity: 'gap' | 'weak' | 'defend'
}

export interface PositioningPoint {
  name: string
  x: number
  y: number
  rationale: string
  isSelf?: boolean
}

export interface StrategyAction {
  title: string
  description: string
  priority: StrategyPriority
  phase: StrategyPhase
  category: '訴求' | 'コンテンツ' | 'SEO' | 'CV導線' | 'サイト改善' | 'その他'
  target: string
  kpi: string
}

export interface CompetitiveStrategyReport {
  generatedAt: string
  summary: string
  observedFacts: string[]
  opportunities: string[]
  positioning: {
    xAxis: string
    yAxis: string
    points: PositioningPoint[]
    whitespace: string
  }
  funnelCoverage: Array<{
    phase: StrategyPhase
    self: string
    competitor: string
    implication: string
  }>
  actions: StrategyAction[]
  caveats: string[]
}

export interface CompetitiveAnalysisDocument {
  updatedAt: string
  competitors: Record<string, CompetitorResult>
  /** Ahrefs取得済みの自社KW。画面表示のたびにAPIを消費しないため保存する */
  selfKeywords?: CompetitorKeyword[]
  selfKeywordUpdatedAt?: string
  report?: CompetitiveStrategyReport
}

export interface CompetitiveAnalysisSnapshot {
  date: string
  savedAt: string
  document: CompetitiveAnalysisDocument
}

export const DEFAULT_COMPETITORS: CompetitorConfig[] = [
  {
    id: 'batonz',
    name: 'BATONZ（バトンズ）',
    domain: 'batonz.jp',
    type: 'direct',
    note: '中小企業・小規模事業者向けのM&A／事業承継プラットフォーム。',
    urls: [{ url: 'https://batonz.jp/', label: 'トップページ' }],
  },
  {
    id: 'tranbi',
    name: 'TRANBI（トランビ）',
    domain: 'tranbi.com',
    type: 'direct',
    note: '売り手と買い手のオンライン直接マッチング型M&Aプラットフォーム。',
    urls: [{ url: 'https://www.tranbi.com/', label: 'トップページ' }],
  },
  {
    id: 'ma-succeed',
    name: 'M&Aサクシード',
    domain: 'ma-succeed.jp',
    type: 'direct',
    note: '法人限定・審査制のM&Aプラットフォーム。',
    urls: [{ url: 'https://ma-succeed.jp/', label: 'トップページ' }],
  },
  {
    id: 'ma-cloud',
    name: 'M&Aクラウド',
    domain: 'macloud.jp',
    type: 'direct',
    note: '買い手企業の買収ニーズ公開と直接アプローチを特徴とするM&Aサービス。',
    urls: [{ url: 'https://macloud.jp/', label: 'トップページ' }],
  },
  {
    id: 'fundbook',
    name: 'fundbook（ファンドブック）',
    domain: 'fundbook.co.jp',
    type: 'direct',
    note: 'M&A仲介と独自マッチングプラットフォームを組み合わせたサービス。',
    urls: [{ url: 'https://fundbook.co.jp/', label: 'トップページ' }],
  },
  {
    id: 'ma-soken',
    name: 'M&A総研',
    domain: 'masouken.com',
    type: 'direct',
    note: 'M&A仲介サービス。専門性・成約スピード・実績訴求を比較対象とする。',
    urls: [{ url: 'https://masouken.com/', label: 'トップページ' }],
  },
]

function isoDateJst(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
}

function decodeEntities(text: string): string {
  return text
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

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return m?.[1] ?? ''
}

function metaContent(html: string, name: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'name') || attr(tag, 'property')).toLowerCase()
    if (key === name.toLowerCase()) return decodeEntities(attr(tag, 'content'))
  }
  return ''
}

function extractHeadings(html: string): string[] {
  const out: string[] = []
  const re = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[2])
    if (text) out.push(`H${m[1]}: ${text}`)
  }
  return out.slice(0, 25)
}

function isAllowedCompetitorUrl(raw: string, competitor: CompetitorConfig): boolean {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' &&
      (parsed.hostname === competitor.domain || parsed.hostname.endsWith(`.${competitor.domain}`))
  } catch {
    return false
  }
}

function extractJson(text: string): string {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI応答からJSONを抽出できませんでした')
  return cleaned.slice(start, end + 1)
}

/**
 * Claudeは長い構造化出力で、まれに末尾のカンマ・配列閉じを落とすことがある。
 * JSON.parseが失敗した場合は、同じ内容を再分析させず「JSON構文の修復」だけを
 * 短い追加呼び出しで行う。
 */
async function generateJson<T>(prompt: string, maxTokens = 6_000): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await generateWithClaude(prompt, { maxTokens, temperature: 0.35 })
      try {
        return JSON.parse(extractJson(raw)) as T
      } catch (parseError) {
        console.warn('[CompetitiveAnalysis] JSON構文エラー。修復を試行します:', parseError)
        const repaired = await generateWithClaude(
          `次のテキストはJSONとして出力されるべきでしたが、構文エラーがあります。
内容・キー・値をなるべく維持し、厳密に有効なJSONオブジェクトだけを返してください。
説明、Markdown、コードフェンスは一切出力しないでください。

${raw.slice(0, 24_000)}`,
          { maxTokens: Math.min(maxTokens, 5_000), temperature: 0 },
        )
        return JSON.parse(extractJson(repaired)) as T
      }
    } catch (error) {
      lastError = error
      console.warn(`[CompetitiveAnalysis] Claude response failed (${attempt + 1}/2)`, error)
    }
  }
  throw new Error(`AI分析の生成に失敗しました: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export async function loadCompetitorConfig(): Promise<CompetitorConfig[]> {
  const obj = await getS3ObjectAsText(CONFIG_KEY)
  if (!obj) return DEFAULT_COMPETITORS
  try {
    const parsed = JSON.parse(obj.content)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed as CompetitorConfig[] : DEFAULT_COMPETITORS
  } catch {
    return DEFAULT_COMPETITORS
  }
}

export async function saveCompetitorConfig(config: CompetitorConfig[]): Promise<void> {
  const ok = await putS3Object(CONFIG_KEY, JSON.stringify(config, null, 2))
  if (!ok) throw new Error('競合設定のS3保存に失敗しました')
}

export async function loadCompetitiveAnalysis(): Promise<CompetitiveAnalysisDocument> {
  const obj = await getS3ObjectAsText(RESULTS_KEY)
  if (!obj) return { updatedAt: '', competitors: {} }
  try {
    const parsed = JSON.parse(obj.content) as CompetitiveAnalysisDocument
    return { updatedAt: parsed.updatedAt ?? '', competitors: parsed.competitors ?? {}, report: parsed.report }
  } catch {
    return { updatedAt: '', competitors: {} }
  }
}

async function saveCompetitiveAnalysis(doc: CompetitiveAnalysisDocument): Promise<void> {
  const ok = await putS3Object(RESULTS_KEY, JSON.stringify(doc, null, 2))
  if (!ok) throw new Error('競合分析結果のS3保存に失敗しました')
}

export async function loadCompetitiveHistory(): Promise<CompetitiveAnalysisSnapshot[]> {
  const obj = await getS3ObjectAsText(HISTORY_KEY)
  if (!obj) return []
  try {
    const parsed = JSON.parse(obj.content)
    return Array.isArray(parsed) ? parsed as CompetitiveAnalysisSnapshot[] : []
  } catch {
    return []
  }
}

async function snapshotAnalysis(doc: CompetitiveAnalysisDocument): Promise<void> {
  const date = isoDateJst()
  const history = await loadCompetitiveHistory()
  const snapshot: CompetitiveAnalysisSnapshot = { date, savedAt: new Date().toISOString(), document: doc }
  const next = [snapshot, ...history.filter(h => h.date !== date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_HISTORY)
  await putS3Object(HISTORY_KEY, JSON.stringify(next))
}

export async function fetchCompetitorPage(
  competitor: CompetitorConfig,
  page: CompetitorUrl,
): Promise<CompetitorPageSource> {
  if (!isAllowedCompetitorUrl(page.url, competitor)) {
    throw new Error(`競合ドメイン（${competitor.domain}）配下のHTTPS URLのみ取得できます`)
  }
  const response = await fetch(page.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NAS-CompetitiveAnalysis/1.0)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    cache: 'no-store',
  })
  const html = await response.text()
  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return {
    url: page.url,
    label: page.label,
    fetchedAt: new Date().toISOString(),
    httpStatus: response.status,
    title: titleMatch ? stripTags(titleMatch[1]) : '',
    description: metaContent(html, 'description'),
    headings: extractHeadings(body),
    textExcerpt: stripTags(body).slice(0, MAX_SOURCE_CHARS),
  }
}

function fact(value: unknown, page: CompetitorPageSource): SourceFact[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    .slice(0, 5)
    .map(text => ({ text, sourceUrl: page.url, tier: 'Tier1', confirmedAt: page.fetchedAt }))
}

interface AxesResponse {
  message?: string[]
  pricing?: string[]
  offering?: string[]
  positioning?: string[]
  authority?: string[]
}

async function analyzeFiveAxes(competitor: CompetitorConfig, pages: CompetitorPageSource[]): Promise<CompetitorFiveAxes> {
  const source = pages.map(p =>
    `URL: ${p.url}\nTITLE: ${p.title}\nDESCRIPTION: ${p.description}\nHEADINGS:\n${p.headings.join('\n')}\nTEXT:\n${p.textExcerpt}`,
  ).join('\n\n---\n\n')
  const parsed = await generateJson<AxesResponse>(`あなたはBtoB/M&A業界の競合リサーチャーです。
競合「${competitor.name}」の公式サイトから取得した一次情報だけを使い、以下の5軸で観測事実を抜き出してください。
推測、評価、一般論は禁止です。価格が確認できない場合は空配列にしてください。
各項目は1文、最大5件にしてください。

${source}

JSONのみを返してください。
{
  "message":["LP・メッセージの観測事実"],
  "pricing":["価格・無料プランの観測事実"],
  "offering":["機能・提供範囲の観測事実"],
  "positioning":["誰に何を提供するかの観測事実"],
  "authority":["実績・導入事例・専門性・権威性の観測事実"]
}`)
  const sourcePage = pages[0]
  if (!sourcePage) throw new Error('分析できる競合ページがありません')
  return {
    message: fact(parsed.message, sourcePage),
    pricing: fact(parsed.pricing, sourcePage),
    offering: fact(parsed.offering, sourcePage),
    positioning: fact(parsed.positioning, sourcePage),
    authority: fact(parsed.authority, sourcePage),
  }
}

/** 競合の選択ページを収集し、5軸に構造化して保存する */
export async function analyzeCompetitor(
  competitorId: string,
  pages?: CompetitorUrl[],
): Promise<CompetitorResult> {
  const config = await loadCompetitorConfig()
  const competitor = config.find(c => c.id === competitorId)
  if (!competitor) throw new Error('指定された競合が見つかりません')
  const targets = pages?.length ? pages : competitor.urls
  const sourcePages = await Promise.all(targets.map(page => fetchCompetitorPage(competitor, page)))
  const axes = await analyzeFiveAxes(competitor, sourcePages)
  const doc = await loadCompetitiveAnalysis()
  const current = doc.competitors[competitor.id]
  const result: CompetitorResult = {
    competitorId: competitor.id,
    updatedAt: new Date().toISOString(),
    pages: Object.fromEntries(sourcePages.map(page => [page.url, page])),
    axes,
    keywords: current?.keywords,
    keywordUpdatedAt: current?.keywordUpdatedAt,
  }
  doc.competitors[competitor.id] = result
  doc.updatedAt = result.updatedAt
  await saveCompetitiveAnalysis(doc)
  return result
}

/** 競合ドメインのAhrefsオーガニックKWを取得・保存する */
export async function refreshCompetitorKeywords(competitorId: string): Promise<CompetitorResult> {
  const config = await loadCompetitorConfig()
  const competitor = config.find(c => c.id === competitorId)
  if (!competitor) throw new Error('指定された競合が見つかりません')
  const rows = await fetchOrganicKeywords({ target: competitor.domain, limit: 500 })
  const keywords: CompetitorKeyword[] = rows.map(row => ({
    keyword: row.keyword,
    volume: row.volume,
    position: row.position,
    traffic: row.currentTraffic,
    url: row.url,
  }))
  const doc = await loadCompetitiveAnalysis()
  // 自社KWは初回のみ同時取得して保存する。以降の画面表示ではS3保存済みデータを使う。
  if (!doc.selfKeywords) {
    const selfDomain = process.env.AHREFS_TARGET_DOMAIN?.trim()
    if (selfDomain) {
      const selfRows = await fetchOrganicKeywords({ target: selfDomain, limit: 500 })
      doc.selfKeywords = selfRows.map(row => ({
        keyword: row.keyword,
        volume: row.volume,
        position: row.position,
        traffic: row.currentTraffic,
        url: row.url,
      }))
      doc.selfKeywordUpdatedAt = new Date().toISOString()
    }
  }
  const current = doc.competitors[competitor.id]
  const result: CompetitorResult = {
    competitorId: competitor.id,
    updatedAt: new Date().toISOString(),
    pages: current?.pages ?? {},
    axes: current?.axes,
    keywords,
    keywordUpdatedAt: new Date().toISOString(),
  }
  doc.competitors[competitor.id] = result
  doc.updatedAt = result.updatedAt
  await saveCompetitiveAnalysis(doc)
  return result
}

function normalizedKeyword(keyword: string): string {
  return keyword.toLocaleLowerCase('ja-JP').replace(/\s+/g, '').replace(/[　・、。，,]/g, '')
}

function selfKeywordMap(rows: CompetitorKeyword[]): Map<string, CompetitorKeyword> {
  const map = new Map<string, CompetitorKeyword>()
  for (const row of rows) map.set(normalizedKeyword(row.keyword), row)
  return map
}

/** 自社と競合のAhrefs取得済みKWから、実行候補を抽出する */
export async function buildKeywordOpportunities(doc?: CompetitiveAnalysisDocument): Promise<KeywordOpportunity[]> {
  const analysis = doc ?? await loadCompetitiveAnalysis()
  // Ahrefsを画面表示のたびに呼ばず、競合KW更新時に保存した自社データを使う。
  const self = selfKeywordMap(analysis.selfKeywords ?? [])
  const candidate = new Map<string, KeywordOpportunity>()
  for (const [id, result] of Object.entries(analysis.competitors)) {
    const competitor = (await loadCompetitorConfig()).find(c => c.id === id)
    if (!competitor) continue
    for (const row of result.keywords ?? []) {
      if (row.position !== null && row.position > 30) continue
      if (row.volume < 20) continue
      const key = normalizedKeyword(row.keyword)
      const own = self.get(key)
      const opportunity = !own ? 'gap' : (own.position ?? 100) > 20 ? 'weak' : 'defend'
      const current = candidate.get(key) ?? {
        keyword: row.keyword,
        volume: row.volume,
        competitors: [],
        selfPosition: own?.position ?? null,
        opportunity,
      }
      current.volume = Math.max(current.volume, row.volume)
      current.competitors.push({ name: competitor.name, position: row.position, url: row.url })
      if (opportunity === 'gap' || (opportunity === 'weak' && current.opportunity === 'defend')) current.opportunity = opportunity
      candidate.set(key, current)
    }
  }
  return [...candidate.values()]
    .filter(item => item.opportunity !== 'defend')
    .sort((a, b) => b.volume - a.volume || b.competitors.length - a.competitors.length)
    .slice(0, 50)
}

function collectFacts(config: CompetitorConfig[], doc: CompetitiveAnalysisDocument): string {
  return config.map(c => {
    const axes = doc.competitors[c.id]?.axes
    if (!axes) return `${c.name}: 未分析`
    const texts = (items: SourceFact[]) => items.slice(0, 2).map(x => x.text.slice(0, 180)).join(' / ')
    return `${c.name}
メッセージ: ${texts(axes.message)}
価格: ${texts(axes.pricing) || '未確認'}
提供: ${texts(axes.offering)}
立ち位置: ${texts(axes.positioning)}
権威性: ${texts(axes.authority)}`
  }).join('\n\n')
}

interface StrategyResponse {
  summary?: string
  observedFacts?: string[]
  opportunities?: string[]
  positioning?: CompetitiveStrategyReport['positioning']
  funnelCoverage?: CompetitiveStrategyReport['funnelCoverage']
  actions?: StrategyAction[]
  caveats?: string[]
}

function priorities(v: unknown): StrategyPriority {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'medium'
}

function phases(v: unknown): StrategyPhase {
  return v === 'awareness' || v === 'research' || v === 'comparison' || v === 'decision' ? v : 'research'
}

/** 第3段階: 競合・自社SEO・サイト診断・ペルソナを統合し、施策を生成して履歴保存 */
export async function generateCompetitiveStrategy(): Promise<CompetitiveStrategyReport> {
  const [config, doc, personas, siteAudit, seo, opportunities] = await Promise.all([
    loadCompetitorConfig(),
    loadCompetitiveAnalysis(),
    loadPersonaDocument(),
    loadSiteAuditDocument(),
    buildSeoDashboardData('28d'),
    buildKeywordOpportunities(),
  ])
  const competitorFacts = collectFacts(config, doc)
  const personaText = personas
    ? personas.personas.slice(0, 4).map(p => `${p.name}: 課題=${p.pains.slice(0, 3).join('、')} 判断基準=${p.decisionCriteria.slice(0, 3).join('、')}`).join('\n')
    : 'ペルソナ未生成'
  const siteText = siteAudit.overall
    ? `サイト診断: ${siteAudit.overall.summary.slice(0, 800)}\n課題: ${siteAudit.overall.issues.slice(0, 4).join(' / ')}`
    : 'サイト診断未実行'
  const seoText = `GSC: 表示${seo.kpi.current.impressions}、クリック${seo.kpi.current.clicks}、CTR${(seo.kpi.current.ctr * 100).toFixed(1)}%、順位${seo.kpi.current.avgPosition.toFixed(1)}
GA4: セッション${seo.kpi.current.sessions}、CV${seo.kpi.current.conversions}
KW機会: ${opportunities.slice(0, 10).map(k => `${k.keyword}(vol${k.volume}, ${k.opportunity}, 競合:${k.competitors.map(c => c.name).join('・')})`).join(' / ') || '未取得'}`
  const parsed = await generateJson<StrategyResponse>(`あなたは日本のM&A・業務提携仲介会社「日本提携支援」の戦略コンサルタントです。
以下の競合公式情報（Tier1）・自社SEO実績・サイト診断・仮説ペルソナから、比較表で終わらず日本提携支援が実行すべき施策を提案してください。
事実と仮説を混同せず、根拠が不足する内容は caveats に残してください。一般論（高品質、丁寧等）ではなく、対象ページ/KW/導線まで具体化してください。
出力は簡潔にしてください。文字列中の改行は禁止です。observedFacts と opportunities は各4件以内、actionsは4件以内、caveatsは2件以内にしてください。descriptionは100文字以内にしてください。

## 競合の観測事実
${competitorFacts}

## 自社SEO・KW機会
${seoText}

## 自社サイト診断
${siteText}

## 仮説ペルソナ
${personaText}

JSONのみを返してください。末尾カンマは禁止です。
{
 "summary":"3〜5文",
 "observedFacts":["競合の観測事実（出典に基づく）"],
 "opportunities":["自社が取るべき差別化機会"],
 "positioning":{"xAxis":"2軸の横軸","yAxis":"2軸の縦軸","points":[{"name":"日本提携支援","x":50,"y":50,"rationale":"根拠","isSelf":true},{"name":"競合名","x":50,"y":50,"rationale":"根拠"}],"whitespace":"空白領域と狙い"},
 "funnelCoverage":[{"phase":"awareness|research|comparison|decision","self":"自社の現状","competitor":"競合の強み","implication":"打ち手"}],
 "actions":[{"title":"20字以内","description":"具体施策","priority":"high|medium|low","phase":"awareness|research|comparison|decision","category":"訴求|コンテンツ|SEO|CV導線|サイト改善|その他","target":"対象URLまたはKW","kpi":"追うKPI"}],
 "caveats":["データの限界"]
}`)
  const report: CompetitiveStrategyReport = {
    generatedAt: new Date().toISOString(),
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    observedFacts: Array.isArray(parsed.observedFacts) ? parsed.observedFacts.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
    opportunities: Array.isArray(parsed.opportunities) ? parsed.opportunities.filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
    positioning: parsed.positioning?.points ? parsed.positioning : { xAxis: '専門性', yAxis: '提供範囲', points: [], whitespace: '' },
    funnelCoverage: Array.isArray(parsed.funnelCoverage) ? parsed.funnelCoverage.map(item => ({
      phase: phases(item.phase),
      self: item.self ?? '',
      competitor: item.competitor ?? '',
      implication: item.implication ?? '',
    })).slice(0, 4) : [],
    actions: Array.isArray(parsed.actions) ? parsed.actions
      .filter(action => action && typeof action.title === 'string' && typeof action.description === 'string')
      .map(action => ({ ...action, priority: priorities(action.priority), phase: phases(action.phase) }))
      .slice(0, 8) : [],
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
  }
  if (!report.summary || report.actions.length === 0) throw new Error('戦略提案の応答が不完全でした')
  doc.report = report
  doc.updatedAt = report.generatedAt
  await saveCompetitiveAnalysis(doc)
  await snapshotAnalysis(doc)
  return report
}

export async function getAhrefsUsage() {
  return fetchApiUsage()
}
