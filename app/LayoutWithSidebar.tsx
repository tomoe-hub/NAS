'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  FileEdit,
  FolderOpen,
  Send,
  CalendarDays,
  BookMarked,
  Hash,
  BarChart3,
  ShieldAlert,
} from 'lucide-react'
import MainContentWidth from './MainContentWidth'

const navItems = [
  { href: '/editor',    label: '記事を作成',          icon: FileEdit },
  { href: '/articles',  label: '保存済み記事一覧',     icon: FolderOpen },
  { href: '/published', label: '過去投稿済み記事一覧', icon: Send },
  { href: '/schedule',  label: '投稿スケジュール',     icon: CalendarDays },
  { href: '/prompts',   label: 'プロンプト',           icon: BookMarked },
  { href: '/keywords',  label: 'キーワード',           icon: Hash },
  { href: '/ahrefs',    label: 'KW分析',               icon: BarChart3 },
  { href: '/notice',    label: '注意書き',              icon: ShieldAlert },
]

export default function LayoutWithSidebar({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isLogin = pathname === '/login'

  if (isLogin) {
    return (
      <div
        className="flex-1 flex items-center justify-center min-h-screen px-4"
        style={{
          background:
            'linear-gradient(135deg, #001250 0%, #002C93 45%, #0066ff 80%, #00b4ff 100%)',
        }}
      >
        {children}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      {/* ─── Sidebar ─── */}
      <aside
        className="fixed top-0 left-0 h-screen w-[240px] flex-shrink-0 z-40 flex flex-col"
        style={{
          background:
            'radial-gradient(circle at 12% 10%, rgba(96,165,250,0.32), transparent 38%), ' +
            'linear-gradient(180deg, rgba(7,20,58,0.96) 0%, rgba(10,56,151,0.86) 100%)',
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
          borderRight: '1px solid rgba(255,255,255,0.14)',
          boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.06)',
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-3 px-5 py-5"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.11)' }}
        >
          <div
            className="w-10 h-10 rounded-[11px] flex items-center justify-center font-black text-[15px] text-white flex-shrink-0"
            style={{
              background: 'linear-gradient(145deg, #1769f6, #063994)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 12px 24px rgba(0,0,0,0.22)',
            }}
          >
            N
          </div>
          <div>
            <div className="text-[18px] font-black text-white tracking-tight leading-none">NAS</div>
            <div
              className="text-[11px] font-mono mt-0.5 leading-none"
              style={{ color: 'rgba(234,242,255,0.55)' }}
            >
              NTS Article System
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 min-h-[46px] px-3 rounded-[13px] text-[14px] font-[600] transition-all duration-150"
                style={
                  isActive
                    ? {
                        color: '#ffffff',
                        background: 'rgba(255,255,255,0.15)',
                        border: '1px solid rgba(255,255,255,0.22)',
                        boxShadow:
                          'inset 0 1px 0 rgba(255,255,255,0.18), 0 8px 20px rgba(0,0,0,0.12)',
                      }
                    : {
                        color: 'rgba(234,242,255,0.68)',
                        border: '1px solid transparent',
                      }
                }
              >
                <span
                  className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center flex-shrink-0"
                  style={{
                    background: isActive
                      ? 'rgba(255,255,255,0.18)'
                      : 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.14)',
                  }}
                >
                  <Icon size={13} strokeWidth={2.2} />
                </span>
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div
          className="px-4 pb-5 pt-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.09)' }}
        >
          <div
            className="rounded-[14px] px-3 py-3 text-[11px] leading-relaxed"
            style={{
              color: 'rgba(234,242,255,0.60)',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
            }}
          >
            © NTS — NAS v1
          </div>
        </div>
      </aside>

      {/* ─── Main ─── */}
      <div className="ml-[240px] flex-1 flex flex-col min-h-screen">
        <main className="flex-1 flex items-start justify-center px-6 py-8 lg:px-8 lg:py-10">
          <MainContentWidth>{children}</MainContentWidth>
        </main>
      </div>
    </div>
  )
}
