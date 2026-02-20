export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px]">
        <aside className="relative hidden flex-1 overflow-hidden border-r border-border/70 lg:flex lg:flex-col lg:items-center lg:justify-center lg:px-14">
          <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.18),transparent_68%)]" />
          <div className="pointer-events-none absolute -bottom-20 -right-16 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(var(--accent-color)/0.16),transparent_68%)]" />
          <div className="relative z-10 max-w-md text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent-color)))] text-2xl font-bold text-primary-foreground shadow-[0_16px_44px_hsl(var(--primary)/0.35)]">
              AI
            </div>
            <h1 className="text-3xl font-semibold tracking-tight bg-[linear-gradient(135deg,hsl(var(--hero-from)),hsl(var(--hero-to)))] bg-clip-text text-transparent">
              AIChat
            </h1>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              统一管理模型、会话、知识库与分享链路。登录后继续你上次的对话上下文。
            </p>
            <div className="mt-8 space-y-3 text-left">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" />
                OpenWebUI 风格统一界面
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" />
                支持多模型切换与工具调用
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-primary" />
                移动端与桌面端一致体验
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
