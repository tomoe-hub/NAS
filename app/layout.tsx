import type { Metadata } from 'next'
import '@/styles/globals.css'
import LayoutWithSidebar from './LayoutWithSidebar'

export const metadata: Metadata = {
  title: 'NAS — NTS Article System',
  description: 'NTS社内記事制作ツール',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+JP:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <div className="nas-root">
          <LayoutWithSidebar>{children}</LayoutWithSidebar>
        </div>
      </body>
    </html>
  )
}
