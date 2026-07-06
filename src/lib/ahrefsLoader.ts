/**
 * Ahrefs データセット検索ユーティリティ
 *
 * S3 の kw-analysis/ に保存されている最新のデータセットから
 * 指定キーワードを検索し、競合分析コンテキストの構築に使用する。
 */

import { getS3ObjectAsText, listS3Objects } from '@/lib/s3Reference'
import type { AhrefsDataset, AhrefsKeywordRow, DatasetMeta } from '@/lib/ahrefsCsvParser'

const PREFIX    = 'kw-analysis/'
const INDEX_KEY = `${PREFIX}index.json`

/** インデックスを読み込む */
async function loadDatasetIndex(): Promise<DatasetMeta[]> {
  const obj = await getS3ObjectAsText(INDEX_KEY)
  if (!obj) return []
  try {
    return JSON.parse(obj.content) as DatasetMeta[]
  } catch {
    return []
  }
}

/** データセット JSON を読み込む */
async function loadDataset(id: string): Promise<AhrefsDataset | null> {
  const key = `${PREFIX}datasets/${id}.json`
  const obj = await getS3ObjectAsText(key)
  if (!obj) return null
  try {
    return JSON.parse(obj.content) as AhrefsDataset
  } catch {
    return null
  }
}

/**
 * 最新のデータセットから指定キーワードを検索する。
 * 完全一致 → 部分一致（先頭から）の順で検索。
 * 見つかった場合は AhrefsKeywordRow を返す。見つからない場合は null。
 */
export async function findKeywordInLatestDataset(
  keyword: string,
): Promise<AhrefsKeywordRow | null> {
  if (!keyword.trim()) return null

  let index = await loadDatasetIndex()

  // インデックスが空の場合、datasets/ 下のファイルを直接列挙
  if (index.length === 0) {
    const objects = await listS3Objects(`${PREFIX}datasets/`)
    const datasetKeys = objects
      .map(o => o.key)
      .filter(k => k.endsWith('.json'))
      .sort()
      .reverse()

    if (datasetKeys.length === 0) return null

    // 最新のデータセットを直接ロード
    const obj = await getS3ObjectAsText(datasetKeys[0]!)
    if (!obj) return null
    try {
      const dataset = JSON.parse(obj.content) as AhrefsDataset
      return searchInKeywords(dataset.keywords, keyword)
    } catch {
      return null
    }
  }

  // uploadedAt 降順でソートして最新から検索
  index = [...index].sort((a, b) =>
    new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  )

  // 最新のデータセットから検索（なければ次のデータセットへ）
  for (const meta of index.slice(0, 3)) {
    const dataset = await loadDataset(meta.id)
    if (!dataset) continue
    const found = searchInKeywords(dataset.keywords, keyword)
    if (found) return found
  }

  return null
}

/**
 * キーワード配列から指定キーワードを検索する。
 * 完全一致（大文字小文字・全半角を正規化）→ 前方一致の順。
 */
function searchInKeywords(
  rows: AhrefsKeywordRow[],
  keyword: string,
): AhrefsKeywordRow | null {
  const normalized = normalizeKw(keyword)

  // 完全一致
  for (const row of rows) {
    if (normalizeKw(row.keyword) === normalized) return row
  }

  // 前方一致（「M&A 費用」→「M&A 費用 相場」にマッチ）
  for (const row of rows) {
    if (normalizeKw(row.keyword).startsWith(normalized)) return row
  }

  // 後方一致
  for (const row of rows) {
    if (normalizeKw(row.keyword).endsWith(normalized)) return row
  }

  return null
}

/** キーワードを正規化（小文字化・全角英数を半角に・前後空白削除） */
function normalizeKw(kw: string): string {
  return kw
    .toLowerCase()
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９＆]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xfee0)
    )
}

/**
 * 最新のデータセットを uploadedAt 降順で最大 maxDatasets 件ロードする。
 * KW自動選定（cron）で全タイプのデータセットを横断分析するために使用。
 */
export async function loadRecentDatasets(maxDatasets = 6): Promise<AhrefsDataset[]> {
  let index = await loadDatasetIndex()

  if (index.length === 0) {
    const objects = await listS3Objects(`${PREFIX}datasets/`)
    const datasetKeys = objects
      .map(o => o.key)
      .filter(k => k.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, maxDatasets)
    const results = await Promise.all(
      datasetKeys.map(async key => {
        const obj = await getS3ObjectAsText(key)
        if (!obj) return null
        try {
          return JSON.parse(obj.content) as AhrefsDataset
        } catch {
          return null
        }
      })
    )
    return results.filter((d): d is AhrefsDataset => d !== null)
  }

  index = [...index].sort((a, b) =>
    new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  )
  const results = await Promise.all(
    index.slice(0, maxDatasets).map(meta => loadDataset(meta.id))
  )
  return results.filter((d): d is AhrefsDataset => d !== null)
}

/**
 * 最新データセットから、クエリを部分一致で含むキーワードを検索して返す。
 * 記事分析ページの「手薄カテゴリー → KW候補」提示に使用。
 * ボリューム降順で最大 limit 件。
 */
export async function findRelatedKeywords(
  query: string,
  limit = 5,
): Promise<AhrefsKeywordRow[]> {
  const normalized = normalizeKw(query)
  if (!normalized) return []

  let index = await loadDatasetIndex()
  let rows: AhrefsKeywordRow[] = []

  if (index.length === 0) {
    const objects = await listS3Objects(`${PREFIX}datasets/`)
    const datasetKeys = objects
      .map(o => o.key)
      .filter(k => k.endsWith('.json'))
      .sort()
      .reverse()
    if (datasetKeys.length === 0) return []
    const obj = await getS3ObjectAsText(datasetKeys[0]!)
    if (!obj) return []
    try {
      rows = (JSON.parse(obj.content) as AhrefsDataset).keywords
    } catch {
      return []
    }
  } else {
    index = [...index].sort((a, b) =>
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    )
    // 最新から最大3データセットを統合して検索母数を確保
    for (const meta of index.slice(0, 3)) {
      const dataset = await loadDataset(meta.id)
      if (dataset) rows.push(...dataset.keywords)
    }
  }

  // 部分一致で抽出し、キーワード重複を除去してボリューム降順
  const seen = new Set<string>()
  return rows
    .filter(r => normalizeKw(r.keyword).includes(normalized))
    .filter(r => {
      const key = normalizeKw(r.keyword)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, limit)
}

/**
 * AhrefsKeywordRow から競合分析コンテキスト文字列を生成する。
 * draft/route.ts から呼び出してプロンプトに注入する。
 */
export function buildCompetitorContext(
  keyword: string,
  row: AhrefsKeywordRow,
): string {
  const position   = row.position != null ? `${row.position}位` : '圏外（51位以下）'
  const traffic    = row.currentTraffic != null ? `${row.currentTraffic.toLocaleString()}/月` : '不明'
  const competitor = row.url ? `現在の上位URL: ${row.url}` : '上位競合URL: 不明'

  const intentMap: Record<string, string> = {
    Informational: '情報収集',
    Commercial:    '商業的調査',
    Transactional: '購買・申込',
    Navigational:  'ナビゲーション',
  }
  const intents = row.intents
    ? row.intents
        .split(',')
        .map(i => intentMap[i.trim()] ?? i.trim())
        .join('・')
    : '不明'

  return `ターゲットKW「${keyword}」の現状データ:
- 月間検索数: ${row.volume.toLocaleString()}
- 競合難易度(KD): ${row.kd}
- 現在の自社順位: ${position}
- 現在の自社流入数: ${traffic}
- 検索意図: ${intents}
- ${competitor}

【このKWで上位表示するための指針】
現在の順位（${position}）を改善するため、上位コンテンツより詳細・具体的・NTS固有の情報量で上回ること。
検索意図（${intents}）に正確に応える構成にし、読者の疑問に対して一段深い回答を提供すること。
競合が触れていない視点・NTSのリアルな現場事例・具体的な数値・手順で差別化すること。`
}
