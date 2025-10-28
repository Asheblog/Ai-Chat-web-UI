import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'
import ConsoleSilencer from '@/components/console-silencer'
import { TitleSync } from '@/components/title-sync'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AIChat',
  description: '一个轻量级、易部署的AI聊天应用',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={inter.className}>
        {/* 生产环境禁用前端控制台输出 */}
        <ConsoleSilencer />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TitleSync />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
