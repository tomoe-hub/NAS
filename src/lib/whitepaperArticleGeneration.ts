import { createHash } from 'crypto'
import { PDFParse } from 'pdf-parse'
import { getS3ObjectAsBuffer, getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import { generateWithClaude } from '@/lib/api/claude'
import { saveArticleToS3 } from '@/lib/articleServerStorage'
import type { SavedArticle } from '@/lib/types'
import {
  saveWhitepaperContentMeta,
  type WhitepaperContentMeta,
} from '@/lib/whitepaperContent'

const WHITEPAPER_BUCKET =
  process.env.WHITEPAPER_S3_BUCKET_NAME?.trim() || 'data-for-nas'
const EXTRACTED_PREFIX = 'whitepaper-content/extracted/'

export interface WhitepaperArticleResult {
  articleId: string
  title: string
}

function extractedKey(s3Key: string): string {
  const hash = createHash('sha256').update(s3Key).digest('hex').slice(0, 24)
  return `${EXTRACTED_PREFIX}${hash}.txt`
}

async function extractPdfText(s3Key: string): Promise<string> {
  const cacheKey = extractedKey(s3Key)
  const cached = await getS3ObjectAsText(cacheKey, WHITEPAPER_BUCKET)
  if (cached?.content.trim()) return cached.content

  const object = await getS3ObjectAsBuffer(s3Key, WHITEPAPER_BUCKET)
  if (!object) throw new Error('S3からPDFを取得できませんでした')
  const parser = new PDFParse({ data: object.body })
  try {
    const result = await parser.getText()
    const text = result.text
      .replace(/\u0000/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
    if (text.length < 100) throw new Error('PDFから十分な本文を抽出できませんでした')
    const ok = await putS3Object(cacheKey, text, 'text/plain; charset=utf-8', WHITEPAPER_BUCKET)
    if (!ok) console.warn('[Whitepaper] 抽出テキストのキャッシュ保存に失敗')
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
  const context = selectPdfContext(await extractPdfText(meta.s3Key), savedMeta)
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
