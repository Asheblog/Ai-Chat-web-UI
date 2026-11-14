import Link from 'next/link'
import { Copy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const SHARE_CONTAINER_CLASS = 'mx-auto w-full max-w-[var(--chat-max-width)] px-5 sm:px-6'

export function SharePageHeader({ brandText, isLive }: { brandText: string; isLive: boolean }) {
  return (
    <header className="border-b border-border bg-surface">
      <div className={cn(SHARE_CONTAINER_CLASS, 'flex min-h-16 items-center justify-between gap-4 py-3')}>
        <span className="min-w-0 truncate text-base font-semibold tracking-tight">{brandText}</span>
        <div className="flex shrink-0 items-center gap-2">
          <span role="status" className="inline-flex items-center gap-1.5 rounded-md bg-surface-subtle px-2.5 py-1.5 text-xs text-muted-foreground sm:inline-flex">
            {isLive && <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" />}
            {isLive ? '实时分享' : '公开分享'}
          </span>
          <Button asChild className="h-11 px-4 sm:h-8"><Link href="/main">打开 AIChat</Link></Button>
        </div>
      </div>
    </header>
  )
}

export function SharePageFooter({ brandText }: { brandText: string }) {
  return (
    <footer className="mt-8 border-t border-border py-5">
      <div className={cn(SHARE_CONTAINER_CLASS, 'flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between')}>
        <span>本页面分享由 <span className="font-medium text-foreground">{brandText}</span> 系统生成</span>
        <Button variant="ghost" size="sm" className="h-11 self-start sm:h-8" onClick={() => { void navigator.clipboard?.writeText(window.location.href) }}><Copy aria-hidden="true" className="mr-2 h-3.5 w-3.5" />复制分享链接</Button>
      </div>
    </footer>
  )
}
