import { getServerBranding } from '@/lib/server-branding'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const branding = await getServerBranding()
  const brandText = branding.text.trim() || 'AIChat'

  return (
    <div className="v2-app-surface flex min-h-screen flex-col items-center justify-center px-5 py-12 text-foreground">
      <div className="mb-10 text-center">
        <h1 className="text-display-lg font-semibold tracking-tight text-foreground">
          {brandText}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">智能对话，高效创作</p>
      </div>
      <div className="w-full max-w-[400px]">{children}</div>
    </div>
  )
}
