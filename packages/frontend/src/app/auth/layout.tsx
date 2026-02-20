import { getServerBranding } from '@/lib/server-branding'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const branding = await getServerBranding()
  const brandText = branding.text.trim() || 'AIChat'
  const brandBadge = brandText.replace(/\s+/g, '').slice(0, 2).toUpperCase() || 'AI'

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px]">
        <aside className="relative hidden flex-1 overflow-hidden border-r border-border/70 lg:flex lg:flex-col lg:items-center lg:justify-center lg:px-14">
          <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.18),transparent_68%)]" />
          <div className="pointer-events-none absolute -bottom-20 -right-16 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(var(--accent-color)/0.16),transparent_68%)]" />
          <div className="relative z-10 max-w-md text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent-color)))] text-2xl font-bold text-primary-foreground shadow-[0_16px_44px_hsl(var(--primary)/0.35)]">
              {brandBadge}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight bg-[linear-gradient(135deg,hsl(var(--hero-from)),hsl(var(--hero-to)))] bg-clip-text text-transparent">
              {brandText}
            </h1>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              多模型接入、流式聊天、会话分享与系统配置一体化。登录后继续你上次的对话上下文。
            </p>
            <div className="mt-8 space-y-3 text-left">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" />
                流式聊天：SSE 实时输出、Markdown/代码高亮、LaTeX、图片上传
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" />
                多模型接入：OpenAI、Azure OpenAI、Ollama、Google Generative AI
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" />
                模型大乱斗、任务追踪与连接/模型/配额等系统设置
              </div>
            </div>
          </div>
        </aside>
        <main className="flex w-full items-center justify-center px-5 py-10 lg:w-[440px] lg:px-10">
          <div className="w-full max-w-[360px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
