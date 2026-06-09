import { randomInt } from 'node:crypto'
import { readFile } from 'fs/promises'
import { findFileById, getFilePath } from '@/lib/dataStorage'
import { getS3ObjectAsText, listS3Objects } from '@/lib/s3Reference'

/** 一次執筆で参照する S3 のプレフィックス（md / csv / txt のみ突合）。末尾スラッシュなしでも可 */
const DRAFT_MATERIAL_EXTS = new Set(['.md', '.csv', '.txt'])

const TEXT_MIMES = new Set([
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
])

export function getDraftMaterialsPrefix(): string {
  const raw = process.env.S3_DRAFT_MATERIALS_PREFIX?.trim()
  const p = raw && raw.length > 0 ? raw : 'materials_for_articles/'
  return p.endsWith('/') ? p : `${p}/`
}

export function isDraftMaterialKey(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix) || key.length <= prefix.length) return false
  if (key.endsWith('/')) return false
  const ext = key.includes('.') ? key.slice(key.lastIndexOf('.')).toLowerCase() : ''
  return DRAFT_MATERIAL_EXTS.has(ext)
}

/**
 * 一次執筆・推敲で共有する参照資料の最大文字数。
 * 環境変数 GEMINI_DRAFT_MAX_CONTEXT_CHARS（推敲の再構築ウィンドウ幅にも使用）
 */
export function getDraftContextCharLimit(): number {
  const raw = process.env.GEMINI_DRAFT_MAX_CONTEXT_CHARS?.trim()
  if (raw) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n) && n >= 10_000) return n
  }
  // デフォルトを少し抑え、Vercel の関数時間超過を起こしにくくする
  return 60_000
}

function lineStartIndex(s: string, pos: number): number {
  if (pos <= 0) return 0
  const i = s.lastIndexOf('\n', pos - 1)
  return i === -1 ? 0 : i + 1
}

export function truncateDataContextToRandomWindow(
  full: string,
  contextLimit: number
): { window: string; originalLen: number; start: number } {
  const len = full.length
  if (len <= contextLimit) {
    return { window: full, originalLen: len, start: 0 }
  }

  const maxStart = len - contextLimit
  let start = randomInt(0, maxStart + 1)
  start = lineStartIndex(full, start)
  if (start > maxStart) start = maxStart

  if (start + contextLimit > len) {
    start = len - contextLimit
    const snapped = lineStartIndex(full, start)
    start = snapped <= len - contextLimit ? snapped : len - contextLimit
  }

  return {
    window: full.slice(start, start + contextLimit),
    originalLen: len,
    start,
  }
}

export function longContextSystemNote(contextLimit: number, originalLen: number): string {
  return (
    `\n\n【システム注記】参照資料が長いため、約${contextLimit.toLocaleString()}文字分をランダムな連続範囲から取り込みました（元の合計: 約${originalLen.toLocaleString()}文字）。` +
    '必要な論点が欠ける場合は S3 の対象を絞るか、アップロード資料のみにするか、Google AI Studio で課金を有効にしてください。'
  )
}

async function readUploadPart(fileId: string): Promise<{ name: string; content: string } | null> {
  const meta = await findFileById(fileId)
  if (!meta) return null
  const isText = TEXT_MIMES.has(meta.mimeType) || meta.mimeType.startsWith('text/')
  if (!isText) return null
  const filePath = getFilePath(meta.storedName)
  const content = await readFile(filePath, 'utf-8')
  return { name: meta.originalName, content }
}

/** 一次執筆 API と推敲再構築で同一順序・同一区切りの連結文字列を生成する */
export async function buildFullMaterialsString(fileIds: string[], s3Keys: string[]): Promise<string> {
  const parts: string[] = []
  for (const id of fileIds) {
    const result = await readUploadPart(id)
    if (result) {
      parts.push(`--- 資料（アップロード）：${result.name} ---\n${result.content}`)
    }
  }
  for (const key of s3Keys) {
    const result = await getS3ObjectAsText(key)
    if (result) {
      const name = key.split('/').pop() ?? key
      parts.push(`--- 資料（S3）：${name} ---\n${result.content}`)
    }
  }
  return parts.join('\n\n')
}

/** 一次執筆応答に含め、推敲時に session 経由で返すバインディング */
export interface DraftMaterialBinding {
  version: 1
  fileIds: string[]
  s3Keys: string[]
  windowStart: number
  contextLimit: number
  originalLen: number
  wasTruncated: boolean
  /**
   * RAG モード用: 選択された資料チャンク ID の配列。
   * セットされている場合、推敲時はランダムウィンドウではなくこのIDリストから
   * チャンクテキストを再取得して参照資料を再構築する。
   */
  ragChunkIds?: string[]
}

const MAX_BINDING_FILE_IDS = 80
const MAX_BINDING_S3_KEYS = 500

export function parseDraftMaterialBinding(raw: unknown): DraftMaterialBinding | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== 1) return null
  const fileIds = Array.isArray(o.fileIds) ? o.fileIds.filter((x): x is string => typeof x === 'string') : []
  const s3Keys = Array.isArray(o.s3Keys) ? o.s3Keys.filter((x): x is string => typeof x === 'string') : []
  if (fileIds.length > MAX_BINDING_FILE_IDS || s3Keys.length > MAX_BINDING_S3_KEYS) return null
  const windowStart =
    typeof o.windowStart === 'number' && Number.isFinite(o.windowStart) && o.windowStart >= 0 ? o.windowStart : 0
  const contextLimit =
    typeof o.contextLimit === 'number' && Number.isFinite(o.contextLimit) && o.contextLimit >= 1000
      ? o.contextLimit
      : getDraftContextCharLimit()
  const originalLen =
    typeof o.originalLen === 'number' && Number.isFinite(o.originalLen) && o.originalLen >= 0 ? o.originalLen : 0
  const wasTruncated = o.wasTruncated === true
  const ragChunkIds = Array.isArray(o.ragChunkIds)
    ? o.ragChunkIds.filter((x): x is string => typeof x === 'string')
    : undefined
  // RAGモード（ragChunkIdsあり）はs3Keys/fileIdsが空でも有効
  if (fileIds.length === 0 && s3Keys.length === 0 && (!ragChunkIds || ragChunkIds.length === 0)) return null
  return { version: 1, fileIds, s3Keys, windowStart, contextLimit, originalLen, wasTruncated, ragChunkIds }
}

/**
 * 一次執筆時と同一の参照テキストを再構築する。
 * - ragChunkIds が設定されている場合: RAG で選択したチャンクを再取得
 * - それ以外: 従来のランダムウィンドウ方式
 */
export async function materializeBoundMaterialsForPrompt(binding: DraftMaterialBinding): Promise<string | null> {
  // RAG モード: チャンク ID から再取得
  if (binding.ragChunkIds && binding.ragChunkIds.length > 0) {
    try {
      const { chunksByIds } = await import('@/lib/materialEmbeddings')
      const ragText = await chunksByIds(binding.ragChunkIds)
      if (ragText.trim()) {
        // アップロードファイルがある場合は先頭に追加
        if (binding.fileIds.length > 0) {
          const uploadText = await buildFullMaterialsString(binding.fileIds, [])
          return uploadText.trim() ? `${uploadText}\n\n${ragText}` : ragText
        }
        return ragText
      }
    } catch (e) {
      console.warn('[draftMaterials] RAG チャンク再取得失敗、フォールバック:', e)
    }
  }

  // 従来方式
  const full = await buildFullMaterialsString(binding.fileIds, binding.s3Keys)
  if (!full.trim()) return null

  if (full.length !== binding.originalLen) {
    console.warn(
      `[draftMaterials] 参照資料の長さが一次執筆時と異なります (現在=${full.length}, 記録=${binding.originalLen})。推敲ウィンドウの一致は保証されません。`
    )
  }

  if (!binding.wasTruncated) {
    return full
  }

  const limit = Math.min(binding.contextLimit, full.length)
  const start = Math.min(binding.windowStart, Math.max(0, full.length - limit))
  const windowed = full.slice(start, start + limit)
  return windowed + longContextSystemNote(binding.contextLimit, binding.originalLen)
}

export interface BuildMaterialsResult {
  dataContext: string
  binding: DraftMaterialBinding | null
}

/**
 * 一次執筆用: アップロード ID・解決済み S3 キーから dataContext と binding を生成する。
 */
export async function buildMaterialsDataContextForDraft(
  fileIds: string[],
  resolvedS3Keys: string[]
): Promise<BuildMaterialsResult> {
  const full = await buildFullMaterialsString(fileIds, resolvedS3Keys)
  if (!full.trim()) {
    return { dataContext: '', binding: null }
  }

  const contextLimit = getDraftContextCharLimit()
  if (full.length <= contextLimit) {
    return {
      dataContext: full,
      binding: {
        version: 1,
        fileIds: [...fileIds],
        s3Keys: [...resolvedS3Keys],
        windowStart: 0,
        contextLimit: full.length,
        originalLen: full.length,
        wasTruncated: false,
      },
    }
  }

  const { window, originalLen, start } = truncateDataContextToRandomWindow(full, contextLimit)
  const dataContext = window + longContextSystemNote(contextLimit, originalLen)
  console.warn(
    `[gemini/draft] 参照資料 ランダム窓: offset=${start}, length=${contextLimit}, 元の長さ=${originalLen}。GEMINI_DRAFT_MAX_CONTEXT_CHARS で上限変更可。`
  )

  return {
    dataContext,
    binding: {
      version: 1,
      fileIds: [...fileIds],
      s3Keys: [...resolvedS3Keys],
      windowStart: start,
      contextLimit,
      originalLen,
      wasTruncated: true,
    },
  }
}

/** s3Keys 未指定時に materials プレフィックス下のキーを列挙する */
export async function resolveDraftS3Keys(
  explicitS3Keys: string[],
  materialsPrefix: string
): Promise<string[]> {
  if (explicitS3Keys.length > 0) {
    return explicitS3Keys.filter(k => isDraftMaterialKey(k, materialsPrefix))
  }
  return (await listS3Objects(materialsPrefix)).map(o => o.key).filter(k => isDraftMaterialKey(k, materialsPrefix))
}
