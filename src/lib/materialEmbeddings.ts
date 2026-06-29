/**
 * 資料 Embedding RAG
 *
 * - S3の materials_for_articles/ 下のテキストファイルをチャンク分割
 * - Gemini text-embedding-004 でベクトル化
 * - S3 に material-embeddings/index.json として保存
 * - 記事生成時にコサイン類似度で関連チャンクを取得しプロンプトに注入
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { getS3ObjectAsText, putS3Object, listS3Objects } from '@/lib/s3Reference'
import { getDraftMaterialsPrefix, isDraftMaterialKey } from '@/lib/draftMaterialsContext'

const MATERIAL_EMBEDDING_KEY = 'material-embeddings/index.json'
const EMBEDDING_MODEL = 'text-embedding-004'

/** 事例チャンク判定: パスに以下のキーワードを含むファイルを事例として扱う */
const CASE_PATH_KEYWORDS = ['case', 'jire', 'jirei', 'soudankiroku', 'soudan', 'jireishu']

// ── 型定義 ─────────────────────────────────────────────

export interface MaterialChunk {
  id: string       // "{s3Key}::{chunkIndex}"
  text: string     // 300-500字のチャンクテキスト
  source: string   // ファイル名（s3Key の最後のパートのみ）
  s3Key: string    // フルS3キー
  type: 'case' | 'general'
  vector: number[]
  indexedAt: string
}

type MaterialIndex = Record<string, MaterialChunk>

export interface RelevantChunk {
  id: string
  text: string
  source: string
  type: 'case' | 'general'
  score: number
}

// ── 内部ユーティリティ ──────────────────────────────

/** ファイルパスから事例ファイルかどうかを判定する */
function isCaseFile(s3Key: string): boolean {
  const lower = s3Key.toLowerCase()
  return CASE_PATH_KEYWORDS.some(kw => lower.includes(kw))
}

/**
 * テキストを 300-500 字のチャンクに分割する。
 * 段落区切り（\n\n）を優先し、それでも長い場合は改行（\n）で分割。
 */
export function chunkText(text: string, maxChars = 400): string[] {
  const paragraphs = text.split(/\n\n+/)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    if (current.length + trimmed.length + 2 <= maxChars) {
      current = current ? `${current}\n\n${trimmed}` : trimmed
    } else {
      if (current) {
        chunks.push(current)
        current = ''
      }
      // 段落自体が maxChars を超える場合は改行で細分割
      if (trimmed.length > maxChars) {
        const lines = trimmed.split('\n')
        for (const line of lines) {
          const l = line.trim()
          if (!l) continue
          if (current.length + l.length + 1 <= maxChars) {
            current = current ? `${current}\n${l}` : l
          } else {
            if (current) chunks.push(current)
            // 1行がmaxCharsを超える場合はそのまま1チャンク
            current = l.length > maxChars ? '' : l
            if (l.length > maxChars) chunks.push(l)
          }
        }
      } else {
        current = trimmed
      }
    }
  }

  if (current) chunks.push(current)

  // 最低50文字未満のチャンクは除外
  return chunks.filter(c => c.length >= 50)
}

/** Gemini Embedding API でテキストをベクトル化 */
async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) throw new Error('GEMINI_API_KEY が設定されていません')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL })
  const result = await model.embedContent(text)
  return result.embedding.values
}

/** コサイン類似度（-1 〜 1） */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** S3 から MaterialIndex を読み込む */
async function loadIndex(): Promise<MaterialIndex> {
  const result = await getS3ObjectAsText(MATERIAL_EMBEDDING_KEY)
  if (!result) return {}
  try {
    return JSON.parse(result.content) as MaterialIndex
  } catch {
    return {}
  }
}

/** MaterialIndex を S3 に書き込む */
async function saveIndex(index: MaterialIndex): Promise<boolean> {
  return putS3Object(MATERIAL_EMBEDDING_KEY, JSON.stringify(index), 'application/json')
}

// ── 公開 API ─────────────────────────────────────────

/**
 * クエリベクトルに対して関連するチャンクを返す。
 * - 一般チャンク: 上位 generalK 件
 * - 事例チャンク: 上位 caseK 件（別枠で確保）
 * インデックスが空の場合は空配列を返す。
 */
export async function findRelevantMaterialChunks(
  queryVector: number[],
  opts: { generalK?: number; caseK?: number } = {},
): Promise<RelevantChunk[]> {
  const { generalK = 15, caseK = 5 } = opts
  const index = await loadIndex()
  const entries = Object.values(index)
  if (entries.length === 0) return []

  const scored = entries.map(chunk => ({
    id:     chunk.id,
    text:   chunk.text,
    source: chunk.source,
    type:   chunk.type,
    score:  cosineSimilarity(queryVector, chunk.vector),
  }))

  scored.sort((a, b) => b.score - a.score)

  const caseChunks    = scored.filter(c => c.type === 'case').slice(0, caseK)
  const generalChunks = scored.filter(c => c.type === 'general').slice(0, generalK)

  // 重複なしで結合（スコア降順）
  const seen = new Set<string>()
  const result: RelevantChunk[] = []
  for (const c of [...caseChunks, ...generalChunks]) {
    if (!seen.has(c.id)) {
      seen.add(c.id)
      result.push(c)
    }
  }
  result.sort((a, b) => b.score - a.score)
  return result
}

/**
 * チャンクIDの配列から MaterialChunk テキストを再取得する（推敲時の再構築用）。
 * インデックスに存在しないIDはスキップ。
 */
export async function chunksByIds(ids: string[]): Promise<string> {
  if (ids.length === 0) return ''
  const index = await loadIndex()
  const texts: string[] = []
  for (const id of ids) {
    if (index[id]) {
      texts.push(`--- 資料（${index[id]!.source}）---\n${index[id]!.text}`)
    }
  }
  return texts.join('\n\n')
}

/**
 * 記事生成時に呼び出す軽量な自動ベクトル化。
 * - インデックスにないファイルだけを対象に embedText を実行する。
 * - 既処理のファイルはスキップ（force なし固定）。
 * - ファイルが多い場合の Vercel 関数タイムアウトを避けるため
 *   1 回の呼び出しで処理するファイル数を MAX_AUTO_FILES に制限する。
 * - エラーは握りつぶして警告のみ（生成フローを止めない）。
 */
const MAX_AUTO_FILES = 5

export async function autoEmbedNewMaterials(): Promise<void> {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim()
    if (!apiKey) return // Embedding API がなければスキップ

    const prefix = getDraftMaterialsPrefix()
    const objects = await listS3Objects(prefix)
    const keys = objects.map(o => o.key).filter(k => isDraftMaterialKey(k, prefix))
    if (keys.length === 0) return

    const index = await loadIndex()

    // インデックスに存在しないファイルだけ抽出
    const newKeys = keys.filter(
      k => Object.keys(index).filter(id => id.startsWith(`${k}::`)).length === 0
    )
    if (newKeys.length === 0) return

    const targets = newKeys.slice(0, MAX_AUTO_FILES)
    console.log(`[autoEmbed] 新規ファイル ${newKeys.length} 件検出、最大 ${MAX_AUTO_FILES} 件処理します`)

    let added = 0
    for (const s3Key of targets) {
      try {
        const raw = await getS3ObjectAsText(s3Key)
        if (!raw || !raw.content.trim()) continue

        const chunks = chunkText(raw.content)
        const isCase = isCaseFile(s3Key)
        const sourceName = s3Key.split('/').pop() ?? s3Key

        for (let i = 0; i < chunks.length; i++) {
          const id = `${s3Key}::${i}`
          const vector = await embedText(chunks[i]!)
          index[id] = {
            id,
            text: chunks[i]!,
            source: sourceName,
            s3Key,
            type: isCase ? 'case' : 'general',
            vector,
            indexedAt: new Date().toISOString(),
          }
          added++
        }
        console.log(`[autoEmbed] ${sourceName} → ${chunks.length} チャンク追加`)
      } catch (e) {
        console.warn(`[autoEmbed] スキップ（${s3Key}）:`, e)
      }
    }

    if (added > 0) {
      await saveIndex(index)
      console.log(`[autoEmbed] インデックス保存完了 (${added} チャンク追加)`)
    }
  } catch (e) {
    console.warn('[autoEmbed] 自動ベクトル化をスキップ:', e)
  }
}

/**
 * materials_for_articles/ 下の全ファイルをチャンク化・ベクトル化してインデックスに upsert する。
 * 既にインデックス済みのファイルはスキップ（force=true で強制再生成）。
 * 返却: { done, skipped, failed, chunksAdded }
 */
export async function batchEmbedMaterials(
  force = false,
): Promise<{ done: number; skipped: number; failed: number; chunksAdded: number }> {
  const result = { done: 0, skipped: 0, failed: 0, chunksAdded: 0 }

  const prefix = getDraftMaterialsPrefix()
  const objects = await listS3Objects(prefix)
  const keys = objects.map(o => o.key).filter(k => isDraftMaterialKey(k, prefix))

  if (keys.length === 0) return result

  const index = await loadIndex()

  for (const s3Key of keys) {
    try {
      // ファイル単位で既処理かチェック（IDプレフィックスがs3Keyで始まるエントリが存在するか）
      const existingChunks = Object.keys(index).filter(id => id.startsWith(`${s3Key}::`))
      if (!force && existingChunks.length > 0) {
        result.skipped++
        continue
      }

      // 既存チャンクを削除（再インデックス時）
      if (force) {
        for (const id of existingChunks) {
          delete index[id]
        }
      }

      const raw = await getS3ObjectAsText(s3Key)
      if (!raw || !raw.content.trim()) {
        result.skipped++
        continue
      }

      const chunks = chunkText(raw.content)
      const isCase = isCaseFile(s3Key)
      const sourceName = s3Key.split('/').pop() ?? s3Key

      let chunksFailed = 0
      for (let i = 0; i < chunks.length; i++) {
        const chunkText_str = chunks[i]!
        const id = `${s3Key}::${i}`
        try {
          const vector = await embedText(chunkText_str)
          index[id] = {
            id,
            text:      chunkText_str,
            source:    sourceName,
            s3Key,
            type:      isCase ? 'case' : 'general',
            vector,
            indexedAt: new Date().toISOString(),
          }
          result.chunksAdded++
        } catch (e) {
          console.error(`[MaterialEmbedding] チャンクのベクトル化失敗: ${id}`, e)
          chunksFailed++
        }
      }

      if (chunksFailed > 0) {
        result.failed++
      } else {
        result.done++
      }
    } catch (e) {
      console.error(`[MaterialEmbedding] ファイル処理失敗: ${s3Key}`, e)
      result.failed++
    }
  }

  if (result.chunksAdded > 0) {
    await saveIndex(index)
  }

  return result
}

/**
 * 関連チャンクを 1 つの参照テキスト文字列に組み立てる（プロンプト注入用）。
 */
export function buildMaterialContextFromChunks(chunks: RelevantChunk[]): string {
  if (chunks.length === 0) return ''
  return chunks
    .map(c => `--- 資料（${c.source}）---\n${c.text}`)
    .join('\n\n')
}
