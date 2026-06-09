'use client'

import { useState } from 'react'
import { Database, RefreshCw, CheckCircle2, AlertCircle, FolderOpen, Lightbulb } from 'lucide-react'

export default function MaterialsPage() {
  const [embedding, setEmbedding] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    message: string
    done?: number
    skipped?: number
    failed?: number
    chunksAdded?: number
  } | null>(null)

  const handleEmbed = async (force: boolean) => {
    if (embedding) return
    setEmbedding(true)
    setResult(null)
    try {
      const res = await fetch('/api/materials/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'ベクトル化に失敗しました')
      setResult({ success: true, message: data.message, ...data })
    } catch (e) {
      setResult({
        success: false,
        message: e instanceof Error ? e.message : 'ベクトル化に失敗しました',
      })
    } finally {
      setEmbedding(false)
    }
  }

  return (
    <div className="w-full max-w-2xl py-8">
      <h1 className="text-2xl font-bold text-[#1A1A2E] mb-1">資料更新</h1>
      <p className="text-sm text-[#64748B] mb-8">
        S3の社内資料をAIが読める形式（ベクトルインデックス）に変換します。資料を更新・追加したときは必ずこちらでベクトル化を実行してください。
      </p>

      {/* 手順説明 */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 mb-6">
        <h2 className="text-base font-bold text-[#1A1A2E] mb-4 flex items-center gap-2">
          <FolderOpen size={18} className="text-[#002C93]" />
          資料更新の手順
        </h2>
        <ol className="space-y-4">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#002C93] text-white text-xs font-bold flex items-center justify-center mt-0.5">1</span>
            <div>
              <p className="text-sm font-semibold text-[#1A1A2E]">S3に資料ファイルをアップロード</p>
              <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                AWSコンソールまたはCLIで、<code className="bg-[#F1F5F9] px-1 rounded text-[#334155]">materials_for_articles/</code> フォルダに資料を配置します。対応形式は <strong>.md / .txt / .csv</strong> です。
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#002C93] text-white text-xs font-bold flex items-center justify-center mt-0.5">2</span>
            <div>
              <p className="text-sm font-semibold text-[#1A1A2E]">下のボタンでベクトル化を実行</p>
              <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                「資料をベクトル化」を押すと、新規・未処理のファイルだけをチャンク分割してAIが検索できる形式に変換し、<code className="bg-[#F1F5F9] px-1 rounded text-[#334155]">material-embeddings/index.json</code> に保存します。
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#002C93] text-white text-xs font-bold flex items-center justify-center mt-0.5">3</span>
            <div>
              <p className="text-sm font-semibold text-[#1A1A2E]">次回の記事生成から自動適用</p>
              <p className="text-xs text-[#64748B] mt-0.5 leading-relaxed">
                記事生成時に、テーマ・キーワードに最も関連する資料チャンクが自動で選ばれてプロンプトに注入されます。一般資料から上位15件、事例資料から上位5件が選ばれます。
              </p>
            </div>
          </li>
        </ol>
      </div>

      {/* ヒント */}
      <div
        className="rounded-xl px-4 py-3 mb-6 flex gap-3 items-start"
        style={{
          background: 'rgba(0,44,147,0.05)',
          border: '1px solid rgba(0,44,147,0.15)',
        }}
      >
        <Lightbulb size={16} className="text-[#002C93] flex-shrink-0 mt-0.5" />
        <div className="text-xs text-[#334155] leading-relaxed space-y-1">
          <p><strong>事例ファイルの命名規則：</strong>ファイルパスに <code className="bg-white px-1 rounded border border-[#E2E8F0]">case</code> / <code className="bg-white px-1 rounded border border-[#E2E8F0]">jirei</code> / <code className="bg-white px-1 rounded border border-[#E2E8F0]">soudan</code> を含めると、事例専用枠として優先的に選ばれます。</p>
          <p>例：<code className="bg-white px-1 rounded border border-[#E2E8F0]">materials_for_articles/cases/ma-jirei-01.md</code></p>
          <p><strong>推奨ファイル構成：</strong>1ファイル1,000〜3,000字程度に分割すると、関連箇所の選択精度が上がります。</p>
        </div>
      </div>

      {/* CTA */}
      <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
        <div className="flex items-center gap-2 mb-1">
          <Database size={18} className="text-[#002C93]" />
          <h2 className="text-base font-bold text-[#1A1A2E]">ベクトルインデックスを更新</h2>
        </div>
        <p className="text-xs text-[#64748B] mb-5 leading-relaxed">
          S3に資料を追加・更新したら、下のボタンで反映してください。既にベクトル化済みのファイルはスキップされます。
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleEmbed(false)}
            disabled={embedding}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #002C93 0%, #0050ff 100%)',
              boxShadow: '0 4px 14px rgba(0,44,147,0.25)',
            }}
          >
            {embedding ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                処理中...
              </>
            ) : (
              <>
                <Database size={16} />
                資料をベクトル化
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleEmbed(true)}
            disabled={embedding}
            className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-[#475569] border border-[#E2E8F0] bg-white hover:bg-[#F8FAFC] transition-all disabled:opacity-50"
            title="全ファイルを削除して再インデックス"
          >
            <RefreshCw size={15} />
            全件強制再実行
          </button>
        </div>

        {result && (
          <div
            className={`mt-4 rounded-lg px-4 py-3 flex items-start gap-2.5 text-sm ${
              result.success
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {result.success ? (
              <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5 text-green-600" />
            ) : (
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-red-600" />
            )}
            <div>
              <p className="font-semibold">{result.success ? '完了' : 'エラー'}</p>
              <p className="text-xs mt-0.5">{result.message}</p>
              {result.success && result.chunksAdded != null && (
                <div className="mt-2 flex gap-4 text-xs text-green-700">
                  <span>処理ファイル: <strong>{result.done}</strong></span>
                  <span>追加チャンク: <strong>{result.chunksAdded}</strong></span>
                  <span>スキップ: <strong>{result.skipped}</strong></span>
                  {result.failed ? <span className="text-red-600">失敗: <strong>{result.failed}</strong></span> : null}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
