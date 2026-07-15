'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'

export interface SectionTabItem {
  href: string
  label: string
  icon?: LucideIcon
}

interface SectionTabsProps {
  label: string
  tabs: SectionTabItem[]
}

/**
 * 関連ページを、URLを維持したままページ内タブとして見せる共通ナビゲーション。
 * 各ページの既存UI・状態管理は変更せず、タブ遷移だけを提供する。
 */
export default function SectionTabs({ label, tabs }: SectionTabsProps) {
  const pathname = usePathname()

  return (
    <div className="mb-6">
      <p
        className="mb-2 text-[11px] font-bold tracking-[0.08em]"
        style={{ color: 'var(--text-faint)' }}
      >
        {label}
      </p>
      <nav
        className="flex w-full gap-1 overflow-x-auto rounded-[12px] p-1"
        aria-label={label}
        style={{
          background: 'rgba(18,103,242,0.05)',
          border: '1px solid var(--border)',
        }}
      >
        {tabs.map(({ href, label: tabLabel, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-xs font-bold transition-all"
              style={
                active
                  ? {
                      background: 'var(--surface-raised)',
                      color: '#1267f2',
                      boxShadow: '0 2px 7px rgba(18,103,242,0.12)',
                    }
                  : {
                      color: 'var(--text-muted)',
                    }
              }
            >
              {Icon && <Icon size={14} strokeWidth={2.2} />}
              {tabLabel}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
