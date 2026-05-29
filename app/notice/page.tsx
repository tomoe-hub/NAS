import Link from 'next/link'

/**
 * 一次執筆の注意事項（ターゲットキーワード・ひな形 V2 推奨）を表示するページ
 */
export default function NoticePage() {
  return (
    <div className="w-full py-8 max-w-4xl mx-auto">
      <p className="text-xs font-bold tracking-[0.11em] uppercase mb-1" style={{ color: 'var(--primary)' }}>
        Guardrails &amp; Policy
      </p>
      <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>注意書き</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
        基本プロンプトひな形 V2 の推奨とターゲットキーワードに関する注意です。システム側の出力形式（番号見出し・太字ルール等）と併せてご利用ください。
      </p>

      <div
        className="rounded-[14px] p-5 sm:p-6 mb-6"
        style={{
          background: 'rgba(15,159,110,0.06)',
          border: '1px solid rgba(15,159,110,0.22)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <p className="text-xs font-semibold mb-2" style={{ color: '#0f766e' }}>2026年3月30日時点</p>
        <p className="text-sm leading-relaxed mb-2" style={{ color: '#134e4a' }}>
          一次執筆用のプロンプトは、<strong className="font-semibold" style={{ color: '#0f766e' }}>基本プロンプト ひな形 V2</strong>
          の利用を推奨します。
          <Link
            href="/prompts"
            className="ml-1 font-semibold underline underline-offset-2 hover:opacity-80"
            style={{ color: 'var(--primary)' }}
          >
            プロンプトライブラリ
          </Link>
          から該当テンプレートを選択してください。
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>理由：</span>
          最終アウトプット時のレイアウト・体裁・見出しなどの表現における<strong>デザインの揺れ防止</strong>のためです。ひな形
          V2 をベースに必要な指示を追加する運用を想定しています。
        </p>
      </div>

      <div
        className="rounded-[14px] p-6 sm:p-8 mb-6"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid rgba(18,103,242,0.18)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <h2 className="text-base font-bold pb-2 mb-4" style={{ color: 'var(--primary)', borderBottom: '2px solid rgba(18,103,242,0.22)' }}>
          ターゲットキーワード（必須・構造化データ）
        </h2>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
          一次執筆の際の<strong className="font-semibold" style={{ color: 'var(--ink)' }}>ターゲットキーワードは必ず入れてください</strong>。
        </p>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-muted)' }}>
          入力内容は、WordPress 投稿に含まれる構造化データ（JSON-LD）の{' '}
          <code
            className="rounded px-1.5 py-0.5 text-xs font-mono"
            style={{ color: 'var(--primary)', background: 'rgba(18,103,242,0.07)', border: '1px solid rgba(18,103,242,0.18)' }}
          >
            keywords
          </code>{' '}
          に反映されます。コード（裏側）の記述例は次の通りです。
        </p>
        <pre
          className="mb-4 overflow-x-auto rounded-[10px] p-4 text-xs leading-relaxed font-mono"
          style={{ background: 'rgba(18,103,242,0.04)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          tabIndex={0}
        >{`"keywords": "M&A 手数料 高い, ma 手数料, M&A手数料, M&A コスト",`}</pre>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Google でユーザーがそれらの検索をしたときに表示される仕組みになっているため、
          <strong className="font-semibold" style={{ color: 'var(--ink)' }}>とても重要な項目</strong>です。
        </p>
      </div>
    </div>
  )
}
