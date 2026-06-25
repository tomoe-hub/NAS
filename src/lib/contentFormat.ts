/**
 * 生成された本文テキストに対する共通フォーマット正規化処理。
 *
 * 対象パターン（いずれも「手順・ステップ列挙」でモデルがよく出す崩れ形式）:
 *
 *   A) **ラベル：本文**  ← マークダウン太字ラップ
 *   B) **ラベル**       ← ラベルのみ太字ラップ
 *   C) ラベル：本文     ← 素のプレーンテキスト（太字なし）
 *
 * いずれも「■ ラベル」（h3 見出し）+ 段落(本文) に変換し、
 * プレビュー / WordPress 投稿で NTS テーマの見出し下線を効かせる。
 */

/**
 * 与えられた文字列の「括弧の外」にある最初のコロン（全角：または半角:）の
 * インデックスを返す。日本語・英語の括弧の両方を考慮する。見つからなければ -1。
 */
function findTopLevelColon(s: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '（' || ch === '(' || ch === '【' || ch === '「') depth++
    else if (ch === '）' || ch === ')' || ch === '】' || ch === '」')
      depth = Math.max(0, depth - 1)
    else if (depth === 0 && (ch === '：' || ch === ':')) return i
  }
  return -1
}

/**
 * 見出しとして変換すべき「ラベル」文字列かどうかを判定するヘルパー。
 * - 2〜30 文字以内
 * - 句点「。」を含まない（文章ではなく語句であることを確認）
 * - URL・HTMLタグを含まない
 */
function isValidLabel(s: string): boolean {
  if (!s || s.length < 2 || s.length > 30) return false
  if (/。/.test(s)) return false
  if (/https?:\/\/|<[a-z]/i.test(s)) return false
  return true
}

/**
 * 行が既に見出し形式（番号付き・記号付き）かどうかを判定する。
 * これらはすでに変換ルートが存在するためスキップする。
 */
function isAlreadyHeading(trimmed: string): boolean {
  return (
    /^\d+[．.]\s/.test(trimmed) ||
    /^\d+-\d+[．.]\s/.test(trimmed) ||
    /^[■▶◆●▼]\s/.test(trimmed) ||
    /^\*\*[^*\n]{2,}\*\*[\s　]*[。．.、,：:]?[\s　]*$/.test(trimmed)
  )
}

/** `https://...` のような URL スキーム由来のコロンかどうかを判定する */
function isUrlSchemeColon(source: string, colonIdx: number, body: string): boolean {
  const label = source.slice(0, colonIdx).trim().toLowerCase()
  // 例: 「導入事例はこちらから https://...」で split されると label が "... https" になり、body が "//..." になる
  if (label.endsWith('http') || label.endsWith('https')) return true
  if (body.startsWith('//')) return true
  return false
}

/**
 * 本文テキスト中の「ラベル形式行」を「■ ラベル」+ 段落に正規化する。
 *
 * 変換パターン:
 *   A) `**ラベル：本文**`  → `■ ラベル` + `本文`
 *   B) `**ラベル**`        → `■ ラベル`
 *   C) `ラベル：本文`（空行直後の単独行）→ `■ ラベル` + `本文`
 *
 * パターン C の誤変換防止条件:
 *   - 前行が空行であること（段落途中の「〜：〜」は変換しない）
 *   - ラベル部分が 2〜30 文字かつ句点なし
 *   - 本文部分が存在すること
 *   - 行末が「。」「ます」「です」「ません」などの文末表現で終わっていないこと
 *     （= 完結した文章ではなくラベル+説明の形式であることを確認）
 */
/**
 * 連続する記号見出し（■ ラベル のみで直後に本文がない）を箇条書きに変換する。
 *
 * normalizeBoldLabelLines の後段として呼び出す。
 * Gemini が **ラベルA** / **ラベルB** / **ラベルC** を本文なしで連続出力した場合、
 * normalizeBoldLabelLines で ■ 形式に変換されたあと、さらに ・箇条書き に変換して
 * <h3> が連続する問題を防ぐ。
 *
 * 変換条件:
 *   - 2行以上の ■ ラベル が「直後に本文行なし」で連続している
 *   - 「直後に本文行なし」= 次の非空行もまた ■ ラベル or 文書終端
 *
 * 例（変換前）:
 *   ■ 理由A          ■ 理由B          ■ 理由C
 * 例（変換後）:
 *   ・理由A          ・理由B          ・理由C
 */
export function convertConsecutiveHeadingsToBullets(text: string): string {
  if (!text) return text
  const lines = text.split('\n')

  type LineType = 'heading' | 'empty' | 'body'
  const lineTypes: LineType[] = lines.map(l => {
    const t = l.trim()
    if (/^[■▶◆●▼]\s/.test(t)) return 'heading'
    if (t === '') return 'empty'
    return 'body'
  })

  // 各 heading 行が「直後に本文なし」かを判定（次の非空行も heading か末尾）
  const isBodyless: boolean[] = new Array(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (lineTypes[i] !== 'heading') continue
    let j = i + 1
    while (j < lines.length && lineTypes[j] === 'empty') j++
    // 次の非空行が heading か末尾なら「本文なし」
    if (j >= lines.length || lineTypes[j] === 'heading') {
      isBodyless[i] = true
    }
  }

  // 「本文なしの heading」が隣接している範囲（ランン）を特定
  // → ラン長 >= 2 のものだけ箇条書きに変換
  const inRun: boolean[] = new Array(lines.length).fill(false)
  for (let i = 0; i < lines.length; i++) {
    if (!isBodyless[i]) continue
    // 前後に別の bodyless heading があるか
    let j = i - 1
    while (j >= 0 && lineTypes[j] === 'empty') j--
    const prevIsBodylessHeading = j >= 0 && lineTypes[j] === 'heading' && isBodyless[j]

    let k = i + 1
    while (k < lines.length && lineTypes[k] === 'empty') k++
    const nextIsBodylessHeading = k < lines.length && lineTypes[k] === 'heading' && isBodyless[k]

    if (prevIsBodylessHeading || nextIsBodylessHeading) {
      inRun[i] = true
    }
  }

  // 再構築
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const t = line.trim()

    if (lineTypes[i] === 'heading' && inRun[i]) {
      const label = t.replace(/^[■▶◆●▼]\s*/, '')
      // 前の出力が空行でなければ空行を挿入（箇条書きブロックの開始）
      const prev = out[out.length - 1]?.trim() ?? ''
      if (prev !== '' && !/^[・]/.test(prev)) out.push('')
      out.push(`・${label}`)
    } else {
      out.push(line)
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function normalizeBoldLabelLines(content: string): string {
  if (!content) return content

  const lines = content.split('\n')
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    // ─── パターン A / B: ** ... ** で囲まれた行 ───
    const boldWrap = trimmed.match(
      /^\*\*([^*\n]{2,})\*\*[\s　]*[。．.、,：:]?[\s　]*$/,
    )
    if (boldWrap) {
      const inner = boldWrap[1]!.trim()
      const colonIdx = findTopLevelColon(inner)
      if (colonIdx > 0) {
        const label = inner.slice(0, colonIdx).trim()
        const body = inner.slice(colonIdx + 1).trim()
        if (isValidLabel(label) && body) {
          if (out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('')
          out.push(`■ ${label}`)
          out.push('')
          out.push(body)
          out.push('')
          continue
        }
      } else if (isValidLabel(inner)) {
        if (out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('')
        out.push(`■ ${inner}`)
        out.push('')
        continue
      }
    }

    // ─── パターン D: 記号付き「■ ラベル：本文」行 ───
    // 例: "■ 準備：買い手から依頼を受け..." を
    //     "■ 準備" + 段落本文 に分割して、長文見出し化を防ぐ
    const markerMatch = trimmed.match(/^[■▶◆●▼]\s*(.+)$/)
    if (markerMatch) {
      const inner = markerMatch[1]!.trim()
      const colonIdx = findTopLevelColon(inner)
      if (colonIdx > 0) {
        const label = inner.slice(0, colonIdx).trim()
        const body = inner.slice(colonIdx + 1).trim()
        if (!isUrlSchemeColon(inner, colonIdx, body)) {
          const labelEndsSentence =
            /(?:です|ます|ません|でした|ました|でしょう|ましょう)[。．]?$/.test(label) ||
            /[。．]$/.test(label)
          if (isValidLabel(label) && body && !labelEndsSentence) {
            if (out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('')
            out.push(`■ ${label}`)
            out.push('')
            out.push(body)
            out.push('')
            continue
          }
        }
      }

      // コロンなしでも長文の記号行は見出しではなく通常段落として扱う
      if (inner.length >= 40 || /[。．]$/.test(inner)) {
        out.push(inner)
        continue
      }
    }

    // ─── パターン C: 素の「ラベル：本文」行（太字なし）───
    // 変換条件:
    //   1. 既に見出し形式でない
    //   2. 前行が空行（段落途中の行は対象外）
    //   3. 括弧の外にコロンがある
    //   4. ラベルが有効な語句（isValidLabel）
    //   5. 本文が存在する
    //   6. 行末が文末表現で終わっていない（「ます。」「ません。」等の完結した文章は除外）
    if (!isAlreadyHeading(trimmed) && trimmed.length > 0) {
      const prevTrimmed = i > 0 ? lines[i - 1]!.trim() : ''
      const isPrevEmpty = prevTrimmed === '' || prevTrimmed === '---' || /^-{3,}$/.test(prevTrimmed)

      if (isPrevEmpty) {
        const colonIdx = findTopLevelColon(trimmed)
        if (colonIdx > 0) {
          const label = trimmed.slice(0, colonIdx).trim()
          const body = trimmed.slice(colonIdx + 1).trim()
          if (isUrlSchemeColon(trimmed, colonIdx, body)) {
            out.push(line)
            continue
          }
          // ラベル部分が完結した文章（句点・文末表現）で終わっていたら通常段落とみなす。
          // 本文側（body）が「〜ます。」で終わるのは正常なので行全体では判定しない。
          const labelEndsSentence =
            /(?:です|ます|ません|でした|ました|でしょう|ましょう)[。．]?$/.test(label) ||
            /[。．]$/.test(label)
          if (isValidLabel(label) && body && !labelEndsSentence) {
            if (out.length > 0 && out[out.length - 1]!.trim() !== '') out.push('')
            out.push(`■ ${label}`)
            out.push('')
            out.push(body)
            out.push('')
            continue
          }
        }
      }
    }

    out.push(line)
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
