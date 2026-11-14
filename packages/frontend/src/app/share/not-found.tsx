import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Link2Off } from 'lucide-react'

export default function ShareNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
      <section className="w-full max-w-md space-y-5 rounded-xl border border-border bg-surface p-6 text-center sm:p-8">
        <Link2Off aria-hidden="true" className="mx-auto h-6 w-6 text-muted-foreground" />
        <div className="space-y-2"><h1 className="text-xl font-semibold tracking-tight">分享暂不可用</h1><p className="text-sm leading-relaxed text-muted-foreground">分享可能已过期、被撤销，或链接有误。请联系分享者获取新的链接。</p></div>
        <Button asChild className="h-11"><Link href="/main">打开 AIChat</Link></Button>
      </section>
    </main>
  )
}
