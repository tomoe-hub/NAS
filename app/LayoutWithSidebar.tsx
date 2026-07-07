'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  FileEdit,
  FolderOpen,
  Send,
  CalendarDays,
  BookMarked,
  BarChart3,
  PieChart,
  LineChart,
  Database,
  ShieldAlert,
  Images,
  Users,
} from 'lucide-react'
import MainContentWidth from './MainContentWidth'

const navItems = [
  { href: '/editor',    label: '記事を作成',          icon: FileEdit },
  { href: '/articles',  label: '保存済み記事一覧',     icon: FolderOpen },
  { href: '/published', label: '過去投稿済み記事一覧', icon: Send },
  { href: '/schedule',  label: '投稿スケジュール',     icon: CalendarDays },
  { href: '/library',   label: 'KW/プロンプト',        icon: BookMarked },
  { href: '/ahrefs',    label: 'KW分析',               icon: BarChart3 },
  { href: '/article-analytics', label: '記事分析',      icon: PieChart },
  { href: '/seo',       label: 'SEO分析',              icon: LineChart },
  { href: '/materials', label: '資料更新',              icon: Database },
  { href: '/images',    label: '画像',                  icon: Images },
  { href: '/personas',  label: '仮説ペルソナ',          icon: Users },
  { href: '/notice',    label: '注意書き',              icon: ShieldAlert },
]

export default function LayoutWithSidebar({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isLogin = pathname === '/login'
  const isAhrefs = pathname === '/ahrefs' || pathname.startsWith('/ahrefs/')

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
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.11)' }}
        >
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
        <nav
          className="flex-1 min-h-0 px-3 py-2.5 space-y-0.5 overflow-y-auto [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 min-h-[40px] px-3 rounded-[13px] text-[14px] font-[600] whitespace-nowrap transition-all duration-150"
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
          className="px-4 pb-4 pt-2.5"
          style={{ borderTop: '1px solid rgba(255,255,255,0.09)' }}
        >
          <div
            className="rounded-[14px] px-3 py-2 text-[11px] leading-relaxed"
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
        <main className={`flex-1 flex items-start justify-center py-8 lg:py-10 ${isAhrefs ? 'px-3 lg:px-4' : 'px-6 lg:px-8'}`}>
          <MainContentWidth>{children}</MainContentWidth>
        </main>
      </div>
    </div>
  )
}
