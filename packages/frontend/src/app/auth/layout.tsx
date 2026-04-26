import { getServerBranding } from '@/lib/server-branding'
import { Boxes, MessageCircle } from 'lucide-react'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const branding = await getServerBranding()
  const brandText = branding.text.trim() || 'AIChat'
  const aiPrefixed = /^ai/i.test(brandText)
  const brandRest = aiPrefixed ? brandText.replace(/^ai/i, '') : brandText

  return (
    <div className="min-h-screen bg-[#f8fafc] text-foreground">
      <div className="flex min-h-screen w-full">
        <aside className="relative hidden w-[410px] shrink-0 overflow-hidden border-r border-slate-200/80 bg-[linear-gradient(180deg,#eff6ff_0%,#f8fbff_74%,#f8fafc_100%)] lg:flex lg:flex-col lg:justify-center lg:px-16">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(158deg,transparent_0_32%,rgba(219,234,254,0.7)_32%_54%,transparent_54%)]" />
          <div className="relative z-10">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-[10px] bg-primary text-primary-foreground shadow-[0_14px_30px_rgba(37,99,235,0.24)]">
                <MessageCircle className="h-7 w-7" />
              </div>
              <h1 className="text-[40px] font-semibold leading-none tracking-tight">
                {aiPrefixed ? <span className="text-primary">AI</span> : null}{brandRest}
              </h1>
            </div>
            <p className="mt-8 max-w-[280px] text-base leading-8 text-slate-500">
              智能对话，高效创作，让 AI 助力每一次思考。
            </p>

            <div className="mt-14 space-y-7">
              <div className="flex items-center gap-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-[10px] bg-blue-100 text-primary">
                  <MessageCircle className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-base font-semibold text-slate-900">流式对话</p>
                  <p className="mt-1 text-sm text-slate-500">实时响应，流畅高效的对话体验</p>
                </div>
              </div>
              <div className="h-px w-80 bg-slate-200/80" />
              <div className="flex items-center gap-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-[10px] bg-blue-100 text-primary">
                  <Boxes className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-base font-semibold text-slate-900">多模型管理</p>
                  <p className="mt-1 text-sm text-slate-500">聚合多种模型，灵活切换与管理</p>
                </div>
              </div>
            </div>
          </div>
        </aside>
        <main className="v2-app-surface flex min-h-screen flex-1 items-center justify-center px-5 py-10">
          <div className="w-full max-w-[450px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
