import { createHash } from 'crypto'
import {
  getS3ObjectAsBuffer,
  getS3ObjectAsText,
  listS3Objects,
  putS3Object,
} from '@/lib/s3Reference'
import { generateWithClaude } from '@/lib/api/claude'
import { saveArticleToS3 } from '@/lib/articleServerStorage'
import type { SavedArticle } from '@/lib/types'

const WHITEPAPER_PREFIX = 'Whitepapers/'
const CATALOG_KEY = 'whitepaper-content/catalog.json'
const EXTRACTED_PREFIX = 'whitepaper-content/extracted/'
const WHITEPAPER_BUCKET =
  process.env.WHITEPAPER_S3_BUCKET_NAME?.trim() || 'data-for-nas'

/**
 * 公開サイト（/whitepaper/）でDLを提供している資料だけを登録する。
 * S3へアップロード済みでも未公開の資料は、誤って紹介記事を作らないよう一覧から除外する。
 */
const PUBLISHED_WHITEPAPERS: Record<string, Omit<WhitepaperContentMeta, 's3Key' | 'updatedAt'>> = {
  'Whitepapers/2026-06/nts-seller-guide.pdf': {
    title: 'M&Aを考え始めた1日目に読むべき資料',
    description: 'M&A会社の選び方、企業評価、契約書のチェックポイントまで、売却で損しないために相談前に押さえるべき実務論点をまとめた売り手向けガイドです。',
    downloadPageUrl: 'https://nihon-teikei.co.jp/whitepaper-download-seller-guide/',
    targetKeyword: 'M&A 売り手 進め方',
    thumbnailKey: 'Whitepapers/2026-06/nts-seller-guide-thumbnail.webp',
  },
  'Whitepapers/2026-04/買収磨き上げホワイトペーパー.pdf': {
    title: 'M&Aの「磨き上げ」はどこまで必要？',
    description: '買い手企業が直面する課題を整理し、案件を待つのではなく寄せるための戦略的な事前準備と体制構築を解説する資料です。',
    downloadPageUrl: 'https://nihon-teikei.co.jp/whitepaper-download-polish/',
    targetKeyword: 'M&A 買い手 磨き上げ',
    thumbnailKey: '',
  },
  'Whitepapers/2026-05/NTS_2026年版中小企業白書速報レポート.pdf': {
    title: 'NTS 2026年版中小企業白書速報レポート',
    description: '2026年版中小企業白書の速報データをもとに、中小企業を取り巻く経営環境と事業承継・M&Aの最新動向をまとめたレポートです。',
    downloadPageUrl: 'https://nihon-teikei.co.jp/whitepaper-download-seller/',
    targetKeyword: '中小企業白書 2026 M&A',
    thumbnailKey: '',
  },
}

export interface WhitepaperContentMeta {
  s3Key: string
  title: string
  description: string
  downloadPageUrl: string
  targetKeyword: string
  thumbnailKey: string
  updatedAt: string
}

export interface WhitepaperContentItem extends WhitepaperContentMeta {
  size: number
  lastModified: string
  extracted: boolean
}

export interface WhitepaperArticleResult {
  articleId: string
  title: string
}

interface PdfTextParser {
  getText(): Promise<{ text: string }>
  destroy(): Promise<void>
}

type PdfTextParserConstructor = new (options: { data: Uint8Array }) => PdfTextParser

/**
 * pdf-parse はPDF.jsのESM依存を含み、Next.jsがルート読込時にバンドルすると
 * 開発サーバーでクラッシュする。必要な生成時だけNode.js標準のdynamic importで読む。
 */
async function getPdfParserConstructor(): Promise<PdfTextParserConstructor> {
  const dynamicImport = new Function(
    'specifier',
    'return import(specifier)',
  ) as (specifier: string) => Promise<{ PDFParse?: PdfTextParserConstructor }>
  const pdfParsePackage = await dynamicImport('pdf-parse')
  if (!pdfParsePackage.PDFParse) throw new Error('PDF解析ライブラリを読み込めませんでした')
  return pdfParsePackage.PDFParse
}

function filenameTitle(key: string): string {
  const filename = key.split('/').pop() ?? key
  try {
    return decodeURIComponent(filename).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  } catch {
    return filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  }
}

function defaultMeta(key: string): WhitepaperContentMeta {
  const published = PUBLISHED_WHITEPAPERS[key]
  if (published) {
    return { s3Key: key, ...published, updatedAt: '' }
  }
  return {
    s3Key: key,
    title: filenameTitle(key),
    description: '',
    downloadPageUrl: '',
    targetKeyword: '',
    thumbnailKey: '',
    updatedAt: '',
  }
}

function extractedKey(s3Key: string): string {
  const hash = createHash('sha256').update(s3Key).digest('hex').slice(0, 24)
  return `${EXTRACTED_PREFIX}${hash}.txt`
}

async function loadCatalog(): Promise<Record<string, WhitepaperContentMeta>> {
  const object = await getS3ObjectAsText(CATALOG_KEY, WHITEPAPER_BUCKET)
  if (!object) return {}
  try {
    const parsed = JSON.parse(object.content) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, WhitepaperContentMeta>
  } catch {
    return {}
  }
}

async function saveCatalog(catalog: Record<string, WhitepaperContentMeta>): Promise<void> {
  const ok = await putS3Object(
    CATALOG_KEY,
    JSON.stringify(catalog, null, 2),
    'application/json',
    WHITEPAPER_BUCKET,
  )
  if (!ok) throw new Error('ホワイトペーパーカタログを保存できませんでした')
}

export async function listWhitepaperContent(): Promise<WhitepaperContentItem[]> {
  const [objects, catalog, extractedObjects] = await Promise.all([
    listS3Objects(WHITEPAPER_PREFIX, WHITEPAPER_BUCKET),
    loadCatalog(),
    listS3Objects(EXTRACTED_PREFIX, WHITEPAPER_BUCKET),
  ])
  const extractedSet = new Set(extractedObjects.map(object => object.key))

  return objects
    .filter(object => object.key in PUBLISHED_WHITEPAPERS)
    .map(object => {
      const meta = { ...defaultMeta(object.key), ...catalog[object.key], s3Key: object.key }
      return {
        ...meta,
        size: object.size,
        lastModified: object.lastModified,
        extracted: extractedSet.has(extractedKey(object.key)),
      }
    })
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
}

export async function saveWhitepaperContentMeta(
  update: Omit<WhitepaperContentMeta, 'updatedAt'>,
): Promise<WhitepaperContentMeta> {
  const catalog = await loadCatalog()
  const meta: WhitepaperContentMeta = {
    ...update,
    updatedAt: new Date().toISOString(),
  }
  catalog[update.s3Key] = meta
  await saveCatalog(catalog)
  return meta
}

async function extractPdfText(s3Key: string): Promise<string> {
  const cacheKey = extractedKey(s3Key)
  const cached = await getS3ObjectAsText(cacheKey, WHITEPAPER_BUCKET)
  if (cached?.content.trim()) return cached.content

  const object = await getS3ObjectAsBuffer(s3Key, WHITEPAPER_BUCKET)
  if (!object) throw new Error('S3からPDFを取得できませんでした')
  const PDFParse = await getPdfParserConstructor()
  const parser = new PDFParse({ data: object.body })
  try {
    const result = await parser.getText()
    const text = result.text
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
    if (text.length < 100) throw new Error('PDFから十分な本文を抽出できませんでした')
    const ok = await putS3Object(
      cacheKey,
      text,
      'text/plain; charset=utf-8',
      WHITEPAPER_BUCKET,
    )
    if (!ok) console.warn('[Whitepaper content] 抽出テキストのキャッシュ保存に失敗')
    return text
  } finally {
    await parser.destroy()
  }
}

function selectPdfContext(text: string, meta: WhitepaperContentMeta): string {
  const chunks: string[] = []
  const chunkSize = 4_000
  for (let start = 0; start < text.length; start += chunkSize) {
    chunks.push(text.slice(start, start + chunkSize))
  }
  if (chunks.length <= 14) return text.slice(0, 56_000)

  const terms = `${meta.title} ${meta.targetKeyword}`
    .toLocaleLowerCase('ja')
    .split(/[\s、。・/／]+/)
    .filter(term => term.length >= 2)

  const scored = chunks.map((chunk, index) => {
    const lower = chunk.toLocaleLowerCase('ja')
    const score = terms.reduce((sum, term) => {
      const matches = lower.split(term).length - 1
      return sum + Math.min(matches, 5)
    }, 0)
    return { chunk, index, score }
  })

  const selected = new Map<number, string>()
  for (const item of scored.slice(0, 4)) selected.set(item.index, item.chunk)
  for (const item of [...scored].sort((a, b) => b.score - a.score).slice(0, 10)) {
    selected.set(item.index, item.chunk)
  }
  return [...selected.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, chunk]) => `--- PDF抜粋 ${index + 1} ---\n${chunk}`)
    .join('\n\n')
    .slice(0, 56_000)
}

function parseClaudeArticle(raw: string): { title: string; content: string } {
  const cleaned = raw.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const titleMarker = '<<<TITLE>>>'
  const contentMarker = '<<<CONTENT>>>'
  const titleStart = cleaned.indexOf(titleMarker)
  const contentStart = cleaned.indexOf(contentMarker)
  if (titleStart >= 0 && contentStart > titleStart) {
    return {
      title: cleaned.slice(titleStart + titleMarker.length, contentStart).trim(),
      content: cleaned.slice(contentStart + contentMarker.length).trim(),
    }
  }

  // 旧形式・モデルがJSONを返した場合も受け入れる。
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('Claudeの記事出力を解析できませんでした')
  const parsed = JSON.parse(cleaned.slice(first, last + 1)) as { title?: unknown; content?: unknown }
  if (typeof parsed.title !== 'string' || typeof parsed.content !== 'string') {
    throw new Error('Claudeの記事出力にタイトルまたは本文がありません')
  }
  return { title: parsed.title.trim(), content: parsed.content.trim() }
}

export async function generateWhitepaperArticle(
  meta: Omit<WhitepaperContentMeta, 'updatedAt'>,
): Promise<WhitepaperArticleResult> {
  const savedMeta = await saveWhitepaperContentMeta(meta)
  const pdfText = await extractPdfText(meta.s3Key)
  const context = selectPdfContext(pdfText, savedMeta)

  const prompt = `あなたは日本提携支援のSEO編集者です。
以下のホワイトペーパーを紹介し、読者が資料ダウンロードページから無料DLしたくなる実用的な記事を作成してください。

【厳守】
- PDFにない数値・事実・事例を創作しない
- 記事単体でも役立つ具体的な解説を含め、露骨な宣伝文だけにしない
- 対象KWを自然にタイトル・導入・見出し・本文へ含める
- 本文は日本語で2,500〜4,000字を目安にする
- 見出しは「## 見出し」、小見出しは「### 小見出し」のプレーンテキスト形式
- 最後に必ず「## 無料資料で詳しく確認する」というCTAセクションを置く
- CTAには資料名、読める内容、対象読者、次のURLを省略せず記載する
- URLはPDF直リンクではなく資料DLページのみを使用する
- 出力は指定の区切り形式のみ。前置き・コードフェンス・後書きを付けない

【資料名】
${savedMeta.title}

【資料概要】
${savedMeta.description || 'PDF本文から適切に要約してください'}

【対象キーワード】
${savedMeta.targetKeyword}

【資料ダウンロードページ】
${savedMeta.downloadPageUrl}

【PDF本文・関連抜粋】
${context}

出力形式:
<<<TITLE>>>
記事タイトル
<<<CONTENT>>>
記事本文`

  const raw = await generateWithClaude(prompt, {
    maxTokens: 8_000,
    temperature: 0.45,
    system: '根拠資料に忠実なSEO記事を作る編集者として回答してください。',
  })
  const generated = parseClaudeArticle(raw)
  if (!generated.title || generated.content.length < 500) {
    throw new Error('生成された記事が短すぎます。資料設定を確認してください')
  }

  const id = `whitepaper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const article: SavedArticle = {
    id,
    title: generated.title,
    refinedTitle: '',
    targetKeyword: savedMeta.targetKeyword,
    originalContent: generated.content,
    refinedContent: '',
    imageUrl: '',
    status: 'draft',
    createdAt: new Date().toISOString(),
    wordpressTags: ['ホワイトペーパー'],
    wordCount: generated.content.length,
  }
  const saved = await saveArticleToS3(article)
  if (!saved) throw new Error('生成記事をS3へ保存できませんでした')

  return { articleId: id, title: generated.title }
}
