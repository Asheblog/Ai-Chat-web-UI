import type { Metadata } from 'next'
import { Noto_Sans_SC } from 'next/font/google'
import 'katex/dist/katex.min.css'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'
import ConsoleSilencer from '@/components/console-silencer'
import { TitleSync } from '@/components/title-sync'
import { getServerBranding } from '@/lib/server-branding'

const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  fallback: [
    'PingFang SC',
    'Microsoft YaHei',
    'HarmonyOS Sans',
    'Noto Sans SC',
    'Segoe UI',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
})

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getServerBranding()
  return {
    title: branding.text,
    description: '一个轻量级、易部署的AI聊天应用',
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const branding = await getServerBranding()
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={notoSansSC.className}>
        {/* 生产环境禁用前端控制台输出 */}
        <ConsoleSilencer />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TitleSync initialBrandText={branding.text} initialBrandFallback={branding.isFallback} />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
