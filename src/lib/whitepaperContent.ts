import { createHash } from 'crypto'
import {
  getS3ObjectAsText,
  listS3Objects,
  putS3Object,
} from '@/lib/s3Reference'

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
    thumbnailKey: 'Whitepapers/2026-04/ma-polish-guide.png.png',
  },
  'Whitepapers/2026-05/NTS_2026年版中小企業白書速報レポート.pdf': {
    title: 'NTS 2026年版中小企業白書速報レポート',
    description: '2026年版中小企業白書の速報データをもとに、中小企業を取り巻く経営環境と事業承継・M&Aの最新動向をまとめたレポートです。',
    downloadPageUrl: 'https://nihon-teikei.co.jp/whitepaper-download-seller/',
    targetKeyword: '中小企業白書 2026 M&A',
    thumbnailKey: 'Whitepapers/2026-05/中小企業白書速報サポート-1.png',
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
