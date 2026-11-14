import { getServerBranding } from '@/lib/server-branding'

const FEATURES: Array<[string, string]> = [
  ['多协议统一接入', 'OpenAI 兼容 / Responses / Gemini 三种协议，一次配置随处可用'],
  ['工具链开箱即用', '联网搜索、网页读取、Python 沙箱、深度研究都在同一个会话里'],
  ['数据留在自己手里', '可自部署，密钥进 Vault，调用全程可审计'],
]

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const branding = await getServerBranding()
  const brandText = branding.text.trim() || 'AIChat'
  const initial = brandText.charAt(0).toUpperCase()

  return (
    <div className="grid min-h-screen w-full grid-cols-1 text-foreground lg:grid-cols-[600px_1fr]">
      <aside className="hidden flex-col justify-between border-r border-border bg-canvas px-14 py-14 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-foreground text-[15px] font-bold leading-none text-background">
            {initial}
          </span>
          <span className="text-[15px] font-medium tracking-tight">{brandText}</span>
        </div>

        <div className="max-w-[470px]">
          <h1 className="text-[34px] font-bold leading-[1.45] tracking-[-0.6px] text-foreground">
            把模型接进来，
            <br />
            剩下的交给 {brandText}。
          </h1>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(([title, desc]) => (
              <li key={title} className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-signal-soft text-[11px] leading-none text-signal-text">
                  ✓
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-snug text-foreground">{title}</span>
                  <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-tertiary">{desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-ink-tertiary">开源 · 可自部署 · MIT License</p>
      </aside>

      <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-5 py-12">
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-[8px] bg-foreground text-[13px] font-bold leading-none text-background">
            {initial}
          </span>
          <span className="text-[14px] font-medium tracking-tight">{brandText}</span>
        </div>
        <div className="w-full max-w-[352px]">{children}</div>
      </main>
    </div>
  )
}
