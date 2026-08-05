import type { Metadata } from 'next'
import { Source_Sans_3, Noto_Sans_SC } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'
import ConsoleSilencer from '@/components/console-silencer'
import { TitleSync } from '@/components/title-sync'
import { BrandThemeInjector } from '@/components/brand-theme-injector'
import { getServerBranding } from '@/lib/server-branding'

const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-source-sans',
})

const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sc',
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
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: '16x16 32x32 48x48 64x64 128x128 256x256' },
        { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
        { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
        { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
        { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
      ],
      apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
    },
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
      <body className={`${sourceSans.variable} ${notoSansSC.variable} antialiased`}>
        <ConsoleSilencer />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <BrandThemeInjector initialTheme={branding.theme} />
          <TitleSync initialBrandText={branding.text} initialBrandFallback={branding.isFallback} />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
