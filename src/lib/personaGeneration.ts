/**
 * 仮説ペルソナ生成（サーバー専用）。
 *
 * 一次データ:
 * 1. WordPress の「M&A成約インタビュー」記事（公開・非公開）
 * 2. S3 の匿名導入事例集（case-studies/anonymous-cases.md）
 * 3. Ahrefs KWデータ（検索需要の定量データ。ブランドKW除外）
 *
 * これらを Claude に渡し、マーケティング戦略用の
 * 「ペルソナ × フェーズ × チャネル × カスタマージャーニー」を
 * 構造化JSONで生成して S3（personas/personas.json）に保存する。
 */

import { generateWithClaude } from '@/lib/api/claude'
import { generateTextWithFallback } from '@/lib/api/gemini'
import { getS3ObjectAsText, putS3Object } from '@/lib/s3Reference'
import { loadRecentDatasets } from '@/lib/ahrefsLoader'
import { fetchInterviewPosts } from '@/lib/wpInterviews'
import type { AhrefsKeywordRow } from '@/lib/ahrefsCsvParser'

const PERSONAS_KEY = 'personas/personas.json'
const CASE_STUDIES_KEY = 'case-studies/anonymous-cases.md'

/** 1インタビューあたりプロンプトに渡す最大文字数 */
const MAX_INTERVIEW_CHARS = 6000
/** 事例集の最大文字数 */
const MAX_CASE_STUDY_CHARS = 8000
/** プロンプトに渡すKW数 */
const MAX_KEYWORDS = 60

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

export interface PersonaJourneyStage {
  /** フェーズ名（認知 / 情報収集 / 比較検討 / 意思決定 / 成約後） */
  phase: string
  /** そのフェーズでの心理状態・行動 */
  state: string
  /** 主な接点チャネル */
  touchpoints: string[]
  /** 求めている情報 */
  needs: string
  /** 障壁・離脱リスク（※推測を含む） */
  barriers: string
  /** NTSが取るべき施策 */
  actions: string
}

export interface PersonaChannelStrategy {
  channel: string
  priority: '高' | '中' | '低'
  approach: string
}

export interface HypothesisPersona {
  id: string
  /** 仮名＋類型（例: 「承継バトン型・田村さん」） */
  name: string
  /** 一言サマリー */
  tagline: string
  attributes: {
    age: string
    role: string
    industry: string
    companySize: string
    region: string
  }
  background: string
  goals: string[]
  pains: string[]
  /** M&A検討の引き金となった出来事 */
  triggers: string[]
  infoSources: string[]
  decisionCriteria: string[]
  /** インタビュー由来の象徴的なひと言 */
  quote: string
  /** このペルソナが検索しそうなKW（Ahrefsデータと突合） */
  keywords: string[]
  journey: PersonaJourneyStage[]
  channelStrategy: PersonaChannelStrategy[]
}

export interface PersonaDocument {
  personas: HypothesisPersona[]
  /** 全ペルソナ横断のマーケティング戦略示唆 */
  overallInsights: string[]
  /** データ上の限界・注意点（生存者バイアス等） */
  caveats: string[]
  dataSources: {
    interviewCount: number
    interviewTitles: string[]
    hasCaseStudies: boolean
    ahrefsKeywordCount: number
  }
  generatedAt: string
}

// ─────────────────────────────────────────────
// 保存・読み込み
// ─────────────────────────────────────────────

export async function loadPersonaDocument(): Promise<PersonaDocument | null> {
  const obj = await getS3ObjectAsText(PERSONAS_KEY)
  if (!obj) return null
  try {
    return JSON.parse(obj.content) as PersonaDocument
  } catch {
    return null
  }
}

async function savePersonaDocument(doc: PersonaDocument): Promise<void> {
  const ok = await putS3Object(PERSONAS_KEY, JSON.stringify(doc, null, 2))
  if (!ok) throw new Error('ペルソナのS3保存に失敗しました')
}

// ─────────────────────────────────────────────
// 入力データ収集
// ─────────────────────────────────────────────

/** Ahrefsの直近データセットから非ブランドKWをボリューム降順で集める */
async function collectTopKeywords(): Promise<AhrefsKeywordRow[]> {
  try {
    const datasets = await loadRecentDatasets(6)
    const byKeyword = new Map<string, AhrefsKeywordRow>()
    for (const ds of datasets) {
      for (const row of ds.keywords) {
        if (row.branded) continue
        if (!row.keyword?.trim()) continue
        const existing = byKeyword.get(row.keyword)
        if (!existing || row.volume > existing.volume) {
          byKeyword.set(row.keyword, row)
        }
      }
    }
    return [...byKeyword.values()]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, MAX_KEYWORDS)
  } catch (e) {
    console.warn('[Persona] Ahrefsデータ読み込み失敗（KWなしで続行）:', e)
    return []
  }
}

// ─────────────────────────────────────────────
// プロンプト構築
// ─────────────────────────────────────────────

function buildPersonaPrompt(input: {
  interviews: { title: string; text: string }[]
  caseStudies: string
  keywords: AhrefsKeywordRow[]
}): string {
  const interviewBlocks = input.interviews
    .map((p, i) => {
      const body = p.text.length > MAX_INTERVIEW_CHARS
        ? `${p.text.slice(0, MAX_INTERVIEW_CHARS)}\n…（以下略）`
        : p.text
      return `【インタビュー${i + 1}】${p.title}\n${body}`
    })
    .join('\n\n---\n\n')

  const kwLines = input.keywords
    .map(k => `- ${k.keyword}（月間検索数: ${k.volume}${k.intents ? ` / 意図: ${k.intents}` : ''}）`)
    .join('\n')

  const caseBlock = input.caseStudies
    ? input.caseStudies.slice(0, MAX_CASE_STUDY_CHARS)
    : '（事例資料なし）'

  return `あなたはB2Bマーケティングストラテジストです。M&A仲介会社「株式会社日本提携支援（NTS）」のマーケティング戦略立案のため、以下の一次データから「仮説ペルソナ」を作成してください。

# 一次データ

## 1. 実際の成約者インタビュー（最重要データ。実在の顧客の生の声）
${interviewBlocks || '（インタビューなし）'}

## 2. 匿名化された支援事例集
${caseBlock}

## 3. 実際の検索キーワードデータ（Ahrefs。検索需要の定量データ）
${kwLines || '（KWデータなし）'}

# 作成指示

1. インタビュー・事例から読み取れる顧客類型を **3つの仮説ペルソナ** に整理してください。年齢層・業種・M&A検討の動機（事業承継型／成長戦略型／再生型など）が互いに異なる類型にすること。
2. 各ペルソナには、実際のインタビューで語られた心情・迷い・決断理由を反映し、quote には（要約で構わないので）インタビューの発言に基づく象徴的なひと言を入れてください。
3. keywords には、このペルソナが検索しそうなKWを上記Ahrefsデータの中から優先的に選んでください（データにない語を補う場合は末尾に置く）。
4. journey は必ず「認知」「情報収集」「比較検討」「意思決定」「成約後」の5フェーズで作成してください。barriers（離脱リスク）はインタビューに現れない推測を含むため、断定を避けた表現にすること。
5. channelStrategy は SEO記事・セミナー／ウェビナー・紹介／金融機関連携・自治体連携・広告・メール／ナーチャリングなど、NTSが現実に取りうるチャネルで、ペルソナごとに優先度をつけてください。
6. overallInsights には、3ペルソナを横断して「どのフェーズ×チャネルに注力すべきか」の戦略示唆を4〜6個書いてください。
7. caveats には、このペルソナの限界（成約者のみのデータで失注者視点がない＝生存者バイアス、n=${input.interviews.length}件と少数、など）を明記してください。
8. 社名・個人名など特定可能な固有名詞はペルソナに含めないでください（仮名を使うこと）。

# 出力形式

以下のJSONのみを出力してください。コードフェンスや説明文は不要です。

{
  "personas": [
    {
      "id": "persona-1",
      "name": "類型名・仮名（例: 承継バトン型・田村さん）",
      "tagline": "一言サマリー",
      "attributes": { "age": "60代後半", "role": "創業社長", "industry": "製造業", "companySize": "従業員50名・年商8億円", "region": "地方都市" },
      "background": "背景・現在の状況（200字程度）",
      "goals": ["達成したいこと"],
      "pains": ["不安・悩み"],
      "triggers": ["M&A検討のきっかけ"],
      "infoSources": ["情報収集チャネル"],
      "decisionCriteria": ["パートナー選定・意思決定の基準"],
      "quote": "象徴的なひと言",
      "keywords": ["検索しそうなKW"],
      "journey": [
        { "phase": "認知", "state": "心理状態・行動", "touchpoints": ["接点"], "needs": "求める情報", "barriers": "離脱リスク（推測）", "actions": "NTSが取るべき施策" }
      ],
      "channelStrategy": [
        { "channel": "チャネル名", "priority": "高", "approach": "具体的なアプローチ" }
      ]
    }
  ],
  "overallInsights": ["戦略示唆"],
  "caveats": ["データ上の限界・注意点"]
}`
}

// ─────────────────────────────────────────────
// JSON抽出
// ─────────────────────────────────────────────

function extractJson(text: string): string {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AIの出力からJSONを抽出できませんでした')
  }
  return cleaned.slice(start, end + 1)
}

// ─────────────────────────────────────────────
// メイン: 生成
// ─────────────────────────────────────────────

export async function generatePersonaDocument(): Promise<PersonaDocument> {
  // 1. 一次データ収集（並列）
  const [interviews, caseObj, keywords] = await Promise.all([
    fetchInterviewPosts(),
    getS3ObjectAsText(CASE_STUDIES_KEY),
    collectTopKeywords(),
  ])

  if (interviews.length === 0 && !caseObj) {
    throw new Error(
      'ペルソナ生成の材料が見つかりません（WordPressのインタビュー記事・S3の事例集ともに取得できませんでした）',
    )
  }

  console.log(
    `[Persona] 材料: インタビュー${interviews.length}件 / 事例集${caseObj ? 'あり' : 'なし'} / KW${keywords.length}件`,
  )

  // 2. AI生成（Claude 主・Gemini 予備）
  const prompt = buildPersonaPrompt({
    interviews,
    caseStudies: caseObj?.content ?? '',
    keywords,
  })

  let raw: string
  try {
    raw = await generateWithClaude(prompt, { maxTokens: 16000, temperature: 0.5 })
  } catch (e) {
    console.warn('[Persona] Claude失敗、フォールバックで再試行:', e)
    raw = await generateTextWithFallback(prompt)
  }

  // 3. パース・検証
  const parsed = JSON.parse(extractJson(raw)) as {
    personas?: HypothesisPersona[]
    overallInsights?: string[]
    caveats?: string[]
  }
  if (!Array.isArray(parsed.personas) || parsed.personas.length === 0) {
    throw new Error('AIの出力にペルソナが含まれていませんでした')
  }

  const doc: PersonaDocument = {
    personas: parsed.personas,
    overallInsights: parsed.overallInsights ?? [],
    caveats: parsed.caveats ?? [],
    dataSources: {
      interviewCount: interviews.length,
      interviewTitles: interviews.map(p => p.title),
      hasCaseStudies: Boolean(caseObj),
      ahrefsKeywordCount: keywords.length,
    },
    generatedAt: new Date().toISOString(),
  }

  // 4. S3保存
  await savePersonaDocument(doc)
  console.log(`[Persona] 生成完了: ${doc.personas.length}ペルソナを保存`)

  return doc
}
