import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'

const REGION = process.env.AWS_REGION ?? 'ap-northeast-1'
const BUCKET = process.env.S3_BUCKET_NAME?.trim()
const INDEX_KEY = 'article-images/index.json'

export interface ImageEntry {
  id: string
  s3Key: string
  /** CloudFront or S3 public URL */
  url: string
  title: string
  targetKeyword?: string
  articleId?: string
  prompt?: string
  source: 'generated' | 'uploaded'
  createdAt: string
}

function getClient(): S3Client | null {
  if (!BUCKET) return null
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim()
  if (!accessKeyId || !secretAccessKey) return null
  return new S3Client({ region: REGION, credentials: { accessKeyId, secretAccessKey } })
}

async function readIndex(client: S3Client): Promise<ImageEntry[]> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET!, Key: INDEX_KEY }))
    const text = await res.Body?.transformToString()
    return text ? (JSON.parse(text) as ImageEntry[]) : []
  } catch {
    return []
  }
}

async function writeIndex(client: S3Client, entries: ImageEntry[]): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET!,
      Key: INDEX_KEY,
      Body: JSON.stringify(entries, null, 2),
      ContentType: 'application/json',
    })
  )
}

/** インデックスを取得（S3未設定の場合は空配列）。URLはアプリ内配信APIに差し替える */
export async function listImages(): Promise<ImageEntry[]> {
  const client = getClient()
  if (!client) return []
  const entries = await readIndex(client)
  return entries
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((e) => ({ ...e, url: `/api/image-library/file?id=${encodeURIComponent(e.id)}` }))
}

/** 画像バイナリをS3から取得（配信API用） */
export async function getImageFile(
  id: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const client = getClient()
  if (!client) return null
  const entries = await readIndex(client)
  const entry = entries.find((e) => e.id === id)
  if (!entry) return null
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: BUCKET!, Key: entry.s3Key })
    )
    const bytes = await res.Body?.transformToByteArray()
    if (!bytes) return null
    return {
      buffer: Buffer.from(bytes),
      contentType: res.ContentType ?? (entry.s3Key.endsWith('.png') ? 'image/png' : 'image/jpeg'),
    }
  } catch {
    return null
  }
}

/** base64画像をS3に保存してインデックスに追加 */
export async function saveImage(params: {
  imageBase64: string
  mimeType: string
  title: string
  targetKeyword?: string
  articleId?: string
  prompt?: string
  source: 'generated' | 'uploaded'
}): Promise<ImageEntry | null> {
  const client = getClient()
  if (!client) return null

  const { imageBase64, mimeType, title, targetKeyword, articleId, prompt, source } = params
  const ext = mimeType.includes('png') ? 'png' : 'jpg'
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const s3Key = `article-images/${id}.${ext}`

  const imgBuffer = Buffer.from(imageBase64, 'base64')
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET!,
      Key: s3Key,
      Body: imgBuffer,
      ContentType: mimeType,
    })
  )

  const cfBase = process.env.CLOUDFRONT_URL?.replace(/\/$/, '')
  const url = cfBase
    ? `${cfBase}/${s3Key}`
    : `https://${BUCKET}.s3.${REGION}.amazonaws.com/${s3Key}`

  const entry: ImageEntry = {
    id,
    s3Key,
    url,
    title,
    targetKeyword,
    articleId,
    prompt,
    source,
    createdAt: new Date().toISOString(),
  }

  const entries = await readIndex(client)
  entries.unshift(entry)
  await writeIndex(client, entries)
  return entry
}

/** インデックスから削除してS3バイナリも削除 */
export async function deleteImage(id: string): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  const entries = await readIndex(client)
  const target = entries.find((e) => e.id === id)
  if (!target) return false

  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET!, Key: target.s3Key }))
  } catch {
    // 既に存在しない場合は無視
  }

  await writeIndex(client, entries.filter((e) => e.id !== id))
  return true
}
