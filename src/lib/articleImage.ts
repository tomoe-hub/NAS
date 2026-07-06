/**
 * アイキャッチ画像生成の共通実装（サーバー専用）。
 *
 * /api/image（エディタからの手動生成）と
 * /api/cron/auto-article（自動生成）の両方から呼ばれる。
 * Gemini でプロンプトを生成し、Bedrock Stable Diffusion 3.5 で画像化する。
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { generateImagePromptFromArticle } from '@/lib/api/gemini'
import { saveImage } from '@/lib/imageLibrary'

/** Stable Diffusion 3.5 は us-west-2 でのみ利用可能 */
const BEDROCK_IMAGE_REGION = 'us-west-2'

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!
}

/** buildPrompt 用: 文字・ロゴを要求しないビジネス系アーキタイプ */
const ARCH_FLATLAY = [
  'overhead flat-lay of business documents and laptop with abstract colorful charts only no legible text, pen and coffee cup on clean white desk, professional stock photography, no people',
  'overhead flat-lay of financial printouts and abstract graphs, calculator and pen on white conference table, no readable numbers, no people, corporate photography',
  'overhead view of clean white desk with documents, laptop showing abstract dashboard graphics, professional M&A advisory workspace, no people',
  'overhead flat-lay of merger agreement stack, corporate stamp, pen and glasses on white desk, no people, professional stock photo',
  'overhead flat-lay on white desk: business papers, two plain solid wooden cubes with no letters or engraving, laptop with abstract charts, pen, no people',
  'close-up overhead of open leather notebook, fountain pen resting on blank page, blurred laptop and documents in background, warm professional lighting, no readable text, no people',
  'flat-lay of Japanese business desk: neatly arranged documents, navy blue folder, minimalist pen and ruler, soft natural light, no people, no text',
] as const

const ARCH_PEOPLE_DESK = [
  'two business professionals in suits at bright white desk, open binder with colorful charts and tablet, hands reviewing documents in sharp focus, faces softly blurred or cropped, modern office, no camera-facing portrait',
  'side view of business colleagues at desk with documents and tablet, emphasis on charts and materials, shallow depth of field, faces not dominant, bright professional office',
  'modern office collaboration on light wooden desk, hands gesturing over laptop with abstract UI blocks, notebook and smartphone, strong bokeh, casual business shirt, second person blurred in background',
  'close-up of two professionals in suits shaking hands over a glass desk, only hands and suit sleeves visible, bright modern office, no faces, professional corporate photography',
  'over-the-shoulder shot of professional reviewing abstract charts on large monitor, blurred second colleague nearby, modern bright office, no legible text on screen',
] as const

const ARCH_SKYLINE = [
  'dramatic low-angle worm-eye view of modern glass skyscrapers converging toward pale sky, cool blue-grey steel and glass facades, some warm lit windows, financial district, no people visible',
  'twilight aerial view of dense Japanese city financial district, warm office lights glowing in glass towers, deep blue sky, no people visible, cinematic wide shot',
  'symmetrical perspective of modern high-rise office corridor, glass and steel architecture, cool blue morning light, empty and professional, no people',
] as const

const ARCH_MEETING_WIDE = [
  'wide shot of modern conference table, business team seen from behind with laptops and document binders, strategy meeting atmosphere, silhouettes, no facial close-ups',
  'bright minimalist boardroom with long white table, empty chairs, large window with soft morning light, no people, corporate interior photography',
  'panoramic shot of sleek open-plan office, clean desks, abstract data visualization on large wall screen, plants, soft natural light, no people, corporate interior',
] as const

const ARCH_GRAPH_DATA = [
  'abstract 3D bar charts and pie graphs floating in clean white space, soft shadows, professional data visualization, no text labels, corporate infographic style, no people',
  'close-up of financial dashboard on tablet screen showing abstract colored graphs and trend lines, no readable numbers, blurred background office, corporate stock photo',
  'digital double-exposure of city skyline and abstract business growth chart lines, navy blue gradient background, no text, professional corporate concept',
] as const

const ARCH_NATURE_TRUST = [
  'minimalist Japanese corporate office reception with low green plants, white walls, light oak wood desk, soft diffused daylight, no people, high-end professional interior',
  'serene zen-inspired meeting room with stone elements, bamboo accent wall, natural wood table, soft light, professional Japanese business atmosphere, no people',
] as const

const ARCH_LIBRARY_EXPERTISE = [
  'professional bookshelf with neatly arranged law and business books, warm library lighting, leather chair in foreground slightly blurred, no people, professional expertise setting',
  'close-up of neat stack of business strategy books with a pair of glasses resting on top, warm desk lamp light, no readable titles, professional corporate photography',
] as const

function getBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? BEDROCK_IMAGE_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  })
}

/** タイトル・KWからテーマに合ったフォールバックプロンプトを構築 */
export function buildFallbackImagePrompt(title: string, targetKeyword?: string): string {
  const text = title + (targetKeyword ?? '')

  const isContract = /契約|NDA|秘密保持|意向表明/.test(text)
  const isFinance = /補助金|税制|融資|資金|節税|バリュエーション|企業価値/.test(text)
  const isPMI = /PMI|統合|経営統合/.test(text)
  const isSuccession = /後継者|引継|承継/.test(text)
  const isMA = /M&A|買収|合併|仲介|売却/.test(text)
  const isData = /分析|調査|統計|データ|レポート|ランキング|比較/.test(text)
  const isExpertise = /専門|顧問|コンサル|士業|弁護士|会計士|税理士/.test(text)

  let theme = ''

  if (isContract) {
    theme = pickRandom([
      ...ARCH_FLATLAY,
      'overhead flat-lay of stacked business contract documents and fountain pen on white desk, abstract seals only no readable clauses, no people',
      ...ARCH_LIBRARY_EXPERTISE,
    ])
  } else if (isFinance) {
    theme = pickRandom([
      ...ARCH_FLATLAY,
      ...ARCH_GRAPH_DATA,
      'overhead flat-lay of financial charts and business reports on clean white conference table, calculator and pen, abstract graphs only no legible figures, no people',
    ])
  } else if (isPMI) {
    theme = pickRandom([
      ...ARCH_MEETING_WIDE,
      ...ARCH_PEOPLE_DESK,
      ...ARCH_FLATLAY,
      ...ARCH_NATURE_TRUST,
    ])
  } else if (isSuccession) {
    theme = pickRandom([
      'overhead flat-lay of business succession documents, company seal, pen and leather notebook on clean wooden desk, warm office lighting, no readable text, no people',
      ...ARCH_FLATLAY,
      ...ARCH_NATURE_TRUST,
      ...ARCH_LIBRARY_EXPERTISE,
    ])
  } else if (isMA) {
    theme = pickRandom([
      ...ARCH_FLATLAY,
      ...ARCH_PEOPLE_DESK,
      ...ARCH_SKYLINE,
      ...ARCH_MEETING_WIDE,
      ...ARCH_GRAPH_DATA,
    ])
  } else if (isData) {
    theme = pickRandom([
      ...ARCH_GRAPH_DATA,
      ...ARCH_FLATLAY,
      ...ARCH_MEETING_WIDE,
    ])
  } else if (isExpertise) {
    theme = pickRandom([
      ...ARCH_LIBRARY_EXPERTISE,
      ...ARCH_PEOPLE_DESK,
      ...ARCH_FLATLAY,
      ...ARCH_NATURE_TRUST,
    ])
  } else {
    theme = pickRandom([
      ...ARCH_FLATLAY,
      ...ARCH_SKYLINE,
      ...ARCH_MEETING_WIDE,
      ...ARCH_GRAPH_DATA,
      ...ARCH_NATURE_TRUST,
      'overhead flat-lay of Japanese business documents, notebook, pen and laptop with abstract screen, clean office desk, no people',
    ])
  }

  return [
    theme,
    'professional Japanese corporate photography',
    'photorealistic high quality',
    'navy blue white grey color palette',
    'soft natural window lighting',
    'corporate editorial stock style, no selfie, avoid extreme glamor portrait close-ups',
    'no readable text no watermark no logo, abstract charts only',
    'horizontal 16:9 composition',
  ].join(', ')
}

export interface ArticleEyecatchResult {
  imageBase64: string
  mimeType: string
  prompt: string
}

/**
 * 記事のアイキャッチ画像を生成する。
 * 生成成功時は画像ライブラリ（S3）にも保存する。失敗時は throw。
 */
export async function generateArticleEyecatch(
  title: string,
  content?: string,
  targetKeyword?: string,
): Promise<ArticleEyecatchResult> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim()
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('AWS認証情報（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）が設定されていません。.env.local と Vercel の環境変数を確認してください。')
  }

  let prompt: string
  const trimmedContent = content?.trim()
  if (title.trim() && trimmedContent) {
    try {
      prompt = await generateImagePromptFromArticle(title.trim(), trimmedContent)
      prompt = [
        prompt,
        'Professional corporate stock photography',
        'High quality photorealistic',
        'No readable text numbers logos or watermarks anywhere',
        'Abstract charts and screens only without legible labels',
        'Horizontal 16:9',
      ].join(', ')
    } catch (e) {
      console.warn('Gemini image prompt failed, using fallback:', (e as Error)?.message)
      prompt = buildFallbackImagePrompt(title, targetKeyword)
    }
  } else {
    prompt = buildFallbackImagePrompt(title, targetKeyword)
  }

  const requestBody = {
    prompt,
    negative_prompt: [
      'portrait, headshot, close-up face, selfie, beauty glamor model shot',
      'revealing clothing, cleavage, exposed skin',
      'western faces, caucasian, blonde',
      'text, typography, watermark, logo, subtitle, caption',
      'readable text, legible numbers, gibberish letters, random letters, floating letters',
      'carved letters on wood, alphabet blocks, letter cubes, engraved symbols on cubes',
      'garbled UI text, meaningless digits on paper, newspaper headline',
      'cartoon, anime, illustration, painting',
      'low quality, blurry, distorted, deformed',
      'bright neon colors, colorful',
      'nsfw, inappropriate',
      'extra fingers, missing fingers, fused fingers, deformed hands, mutated hands',
      'six fingers, too many fingers, bad hands, malformed hands, extra limbs',
      'extra digits, fewer digits, cropped hands, poorly drawn hands',
    ].join(', '),
    mode: 'text-to-image',
    aspect_ratio: '16:9',
    output_format: 'jpeg',
  }

  const bodyBytes = new TextEncoder().encode(JSON.stringify(requestBody))

  const command = new InvokeModelCommand({
    modelId: 'stability.sd3-5-large-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: bodyBytes,
  })

  const client = getBedrockClient()
  const response = await client.send(command)
  const responseBody = JSON.parse(
    new TextDecoder().decode(response.body)
  ) as { images?: string[]; finish_reasons?: (string | null)[] }

  const reason = responseBody.finish_reasons?.[0]
  if (reason != null && reason !== '') {
    throw new Error(
      'コンテンツフィルターにより画像が生成されませんでした。プロンプトを変えて再試行してください。'
    )
  }

  const base64Image = responseBody.images?.[0]
  if (!base64Image) {
    throw new Error('画像データが返ってきませんでした')
  }

  // 生成成功した画像はサーバー側で必ず画像ライブラリ（S3）に保存する
  try {
    await saveImage({
      imageBase64: base64Image,
      mimeType: 'image/jpeg',
      title: title.trim(),
      targetKeyword,
      prompt,
      source: 'generated',
    })
  } catch (e) {
    console.warn('[ImageLibrary] 自動保存に失敗（画像生成自体は成功）:', (e as Error)?.message)
  }

  return { imageBase64: base64Image, mimeType: 'image/jpeg', prompt }
}
