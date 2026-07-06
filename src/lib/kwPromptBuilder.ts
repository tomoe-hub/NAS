/**
 * KWベース記事生成プロンプトの共通ビルダー。
 *
 * - KW分析ページ（Ahrefsデータあり）: データドリブンの戦略文を含む従来プロンプト
 * - 記事分析ページ（手薄カテゴリー起点）: Ahrefsデータの有無に応じて構成を切り替え、
 *   「カテゴリー網羅性の強化」という文脈を追加する
 */

export interface KwPromptInput {
  /** ターゲットキーワード（必須） */
  keyword: string
  /** 月間検索ボリューム（Ahrefsデータがある場合） */
  volume?: number
  /** Keyword Difficulty */
  kd?: number
  /** CPC（円） */
  cpc?: number
  /** トレンド方向 */
  trend?: 'up' | 'down' | 'stable'
  trendPercent?: number
  /** 自動検出カテゴリ（KW分析の分類） */
  detectedCategory?: string
  /** 優先度ラベル（例: ★★★即攻め） */
  priorityLabel?: string
  /** 優先度スコア */
  score?: number
  /** 手薄カテゴリー補強の文脈（記事分析ページ起点の場合のみ） */
  gap?: {
    /** WordPressのタグ/カテゴリー名 */
    tagName: string
    /** 現在の記事数 */
    articleCount: number
  }
}

const CATEGORY_INTENTS: Record<string, string> = {
  'M&A全般': '\n・M&Aの基本的な流れ・手数料体系・メリットとリスクを知りたい\n・中小企業のM&A成功事例・失敗事例を知りたい',
  '事業承継': '\n・後継者不在の解決策を知りたい\n・親族内承継と第三者承継の違い・それぞれのメリットを理解したい\n・事業承継税制の活用方法を知りたい',
  '企業価値評価': '\n・自社の企業価値を知りたい\n・デューデリジェンスの具体的な進め方・チェックポイントを理解したい\n・バリュエーション手法（DCF、類似企業比較等）の違いを知りたい',
  'PMI・統合': '\n・M&A後の統合プロセス（PMI）の進め方を知りたい\n・買収後の「磨き上げ」で企業価値を高める方法を知りたい\n・従業員のモチベーション維持・組織文化統合のポイントを知りたい',
  'アドバイザー・仲介': '\n・M&Aアドバイザーの選び方・比較ポイントを知りたい\n・仲介手数料の相場・料金体系を理解したい\n・信頼できる相談先を見つけたい',
  '資金調達・補助金': '\n・M&Aに使える補助金・助成金制度を知りたい\n・買収資金の調達方法（LBO、銀行融資等）を理解したい\n・事業再構築補助金の活用事例を知りたい',
  '中小企業経営': '\n・中小企業の経営改善・収益向上策を知りたい\n・事業計画の策定方法を知りたい\n・経営課題の優先順位付けの方法を知りたい',
  '法務・税務': '\n・M&Aに関わる法務手続き・契約書のポイントを知りたい\n・M&Aの税務影響・節税策を知りたい\n・株式譲渡と事業譲渡の法的・税務的違いを理解したい',
}

function buildDataStrategyBlock(input: KwPromptInput): string {
  const { volume, kd, cpc } = input
  if (volume == null || kd == null) return ''

  const volStrategy = volume > 5000
    ? '検索ボリュームが非常に大きいキーワードです。包括的かつ網羅的な内容にし、関連キーワードも幅広くカバーしてください。'
    : volume > 1000
      ? '中程度のボリュームがあります。幅広い検索意図をカバーする構成にしてください。'
      : volume > 300
        ? 'ニッチな専門性と具体性で上位を狙える領域です。深堀りした実務情報を盛り込んでください。'
        : '深い専門知識と具体的な事例で差別化してください。ロングテール戦略として有効です。'

  const kdStrategy = kd <= 10
    ? '競合がほぼ不在です。基本を丁寧に押さえれば上位表示が可能です。'
    : kd <= 30
      ? '独自視点で差別化すれば上位の勝算があります。NTSの実績や事例を活用してください。'
      : kd <= 50
        ? '実体験・具体的数値での差別化が必要です。NTSの支援事例やデータを積極的に引用してください。'
        : '高難度KWです。現場知見・独自データで差別化が必須です。NTSならではの独自分析を前面に出してください。'

  const cpcStrategy = (cpc ?? 0) > 1000
    ? 'CPCが高く商業的意図が強いKWです。具体的なCTAを設置し、無料相談・資料DLへ誘導してください。'
    : (cpc ?? 0) > 300
      ? '一定の商業的価値があります。サービスページや問い合わせフォームへの自然な誘導を含めてください。'
      : '情報収集段階のユーザーが多い可能性があります。信頼構築を重視し、まず価値提供に注力してください。'

  let trendNote = ''
  if (input.trend === 'up') {
    trendNote = `\n▸ トレンド注記: 検索ボリュームが上昇傾向（+${input.trendPercent}%）です。最新の市場動向・法改正・統計データを積極的に取り入れてください。`
  } else if (input.trend === 'down') {
    trendNote = `\n▸ トレンド注記: 検索ボリュームが下降傾向（${input.trendPercent}%）です。「今こそ知っておくべき」等の切り口で再注目を促してください。`
  }

  const dataLines = [
    `・ターゲットキーワード: ${input.keyword}`,
    `・月間検索ボリューム: ${volume.toLocaleString()}`,
    `・KD（Keyword Difficulty）: ${kd}`,
    cpc != null ? `・CPC: ¥${Math.round(cpc).toLocaleString()}` : null,
    input.detectedCategory ? `・カテゴリ: ${input.detectedCategory}` : null,
    input.priorityLabel ? `・優先度: ${input.priorityLabel}${input.score != null ? `（スコア: ${input.score}）` : ''}` : null,
  ].filter(Boolean).join('\n')

  return `■KWデータに基づく執筆方針
${dataLines}

▸ ボリューム戦略: ${volStrategy}
▸ KD戦略: ${kdStrategy}
▸ CPC戦略: ${cpcStrategy}${trendNote}

`
}

function buildGapBlock(gap: NonNullable<KwPromptInput['gap']>): string {
  return `■カテゴリー網羅性の強化（この記事の戦略的位置づけ）
・自社サイト（nihon-teikei.co.jp）では「${gap.tagName}」カテゴリーの記事が現在${gap.articleCount}件と手薄な状態です。
・この記事はカテゴリーの網羅性を高め、サイト全体のトピッククラスターを強化する目的で執筆します。
・「${gap.tagName}」に関連する基礎知識から実務の深い論点までカバーし、同カテゴリーの中核となる記事に仕上げてください。
・既存の他カテゴリー記事（M&Aアドバイザー、事業承継等）への内部リンクを想定した文脈のつながりを意識してください。

`
}

/** KWベース記事生成プロンプトを構築する */
export function buildKwPrompt(input: KwPromptInput): string {
  const hasData = input.volume != null && input.kd != null
  const extraIntents = input.detectedCategory ? (CATEGORY_INTENTS[input.detectedCategory] ?? '') : ''

  const dataBlock = buildDataStrategyBlock(input)
  const gapBlock = input.gap ? buildGapBlock(input.gap) : ''

  const strategyNote = !hasData
    ? `■執筆方針
・このキーワードはAhrefsの計測データが少ないニッチ領域、またはデータ未取得の領域です。
・競合記事が少ない可能性が高いため、NTSの現場知見・具体的事例で先行者優位を確立してください。
・基礎から実務まで網羅した「このテーマの決定版」となる記事を目指してください。

`
    : ''

  return `あなたはM&A・事業承継領域に精通したコンテンツ戦略コンサルタントです。
以下のキーワードデータに基づき、NTS（日本提携支援）の公式コラムとして、検索流入の獲得とE-E-A-Tの訴求を両立した記事を執筆してください。

■テーマ
${input.keyword}

${dataBlock}${strategyNote}${gapBlock}■検索意図の整理
このキーワードで検索するユーザーは以下の情報を求めていると想定されます：
・基本的な概念・定義を理解したい
・具体的な手順・プロセスを知りたい
・費用・相場感を把握したい
・成功事例・失敗事例から学びたい
・信頼できる専門家に相談したい${extraIntents}

■ターゲット
・中小企業の経営者・オーナー
・事業承継を検討中の経営者
・M&Aを初めて検討する企業の経営層・担当者

■必須条件
・NTS（日本提携支援）のM&Aアドバイザリーとしての専門知識・実績を反映すること
・一次執筆時にシステムが読み込む社内資料（S3の日本提携支援向けマテリアル等）を前提に、資料に基づく具体性・独自の現場知を記事に織り込むこと（メタに「資料」「S3」と書かないこと）
・実務に基づいた具体的なアドバイスを含めること
・読者が次のアクションを取りやすいよう、相談窓口やサービスページへの誘導を自然に含めること
・公的機関（中小企業庁、経済産業省等）の統計やガイドラインを適宜引用すること

■トーン・文体（厳守）
・NTSに言及するときは「私たちは〜」「弊社では〜」「NTSでは〜」と自社視点で書くこと。「NTSは確信している」のように三人称で客体化しない。
・文末は「〜です」「〜ます」「〜と考えています」のように丁寧語で統一。「〜だろう」「〜であろう」「〜に他ならない」のような評論家調・学術論文調は禁止。
・「徹底解説する」「完全ガイド」のような煽り表現は使わない。

■キーワード表記（厳守）
・ターゲットキーワードは本文中に自然な日本語として溶け込ませること。「」（鉤括弧）で囲んで繰り返さない。
・半角小文字のまま本文に出さない（例: m&a 相談 → M&Aの相談、M&Aについて相談する）。M&Aは常に大文字表記。

■品質要件
・2500文字以上の読み応えある記事にすること
・専門用語は必ず平易な説明を併記
・冗長な表現を避け、実務で役立つ情報密度の高い記事にすること
・NTSの専門性・信頼性が伝わるトーンで統一
・記事末尾に「よくある質問（FAQ）」セクション（Q&A形式で5問程度）を含めること`
}
