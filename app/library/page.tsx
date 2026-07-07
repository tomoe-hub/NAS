'use client'

import { Suspense, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BookMarked } from 'lucide-react'
import KeywordsTab from '@/components/library/KeywordsTab'
import PromptsTab from '@/components/library/PromptsTab'

type TabKey = 'keywords' | 'prompts'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'keywords', label: 'キーワード' },
  { key: 'prompts', label: 'プロンプト' },
]

function LibraryContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: TabKey = tabParam === 'prompts' ? 'prompts' : 'keywords'

  const handleTabChange = useCallback(
    (tab: TabKey) => {
      router.replace(`/library?tab=${tab}`, { scroll: false })
    },
    [router],
  )

  return (
    <div className="w-full py-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--ink)' }}>
        <BookMarked size={20} />
        KW/プロンプト ライブラリ
      </h1>
      <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
        記事作成で使うキーワードセットとプロンプトテンプレートをまとめて管理します。
      </p>

      {/* Tabs */}
      <div className="flex gap-6 mb-6 border-b border-[#E2E8F0]">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`pb-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'text-[#002C93] border-[#002C93]'
                : 'text-[#64748B] border-transparent hover:text-[#1A1A2E]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'keywords' ? <KeywordsTab /> : <PromptsTab />}
    </div>
  )
}

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryContent />
    </Suspense>
  )
}
