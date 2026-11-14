import type { ReactNode } from 'react'

interface AppShellProps {
  ready: boolean
  sidebar: ReactNode
  toolbar: ReactNode
  children: ReactNode
}

const SkeletonBlock = ({ className }: { className: string }) => (
  <div className={`animate-pulse rounded-md motion-reduce:animate-none bg-surface-subtle ${className}`} />
)

/**
 * /main 的稳定壳：身份未就绪时保留布局骨架，避免 SSR/水合首帧整页空白。
 * 骨架只含非敏感占位，真实导航与内容仅在 ready 后挂载。
 */
export function AppShell({ ready, sidebar, toolbar, children }: AppShellProps) {
  if (!ready) {
    return (
      <div
        className="flex h-screen supports-[height:100dvh]:h-dvh min-h-0 w-full min-w-0 overflow-x-hidden bg-background"
        aria-busy="true"
        data-app-shell="loading"
      >
        <aside
          aria-hidden="true"
          className="hidden w-[268px] shrink-0 flex-col border-r border-border bg-canvas px-3 py-3 lg:flex"
        >
          <div className="flex items-center gap-2.5">
            <SkeletonBlock className="h-[26px] w-[26px]" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
          <SkeletonBlock className="mt-4 h-9 w-full" />
          <SkeletonBlock className="mt-1.5 h-8 w-full" />
          <SkeletonBlock className="mt-1.5 h-8 w-full" />
          <SkeletonBlock className="mt-6 h-9 w-full" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-11 w-full" />
            ))}
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="v2-toolbar grid h-14 shrink-0 grid-cols-3 items-center gap-2 px-4 lg:hidden">
            <SkeletonBlock className="h-9 w-9 justify-self-start" />
            <SkeletonBlock className="h-8 w-28 justify-self-center" />
            <SkeletonBlock className="h-8 w-14 justify-self-end" />
          </div>
          <div className="mx-auto flex w-full max-w-[var(--chat-max-width)] flex-1 flex-col gap-4 px-4 py-8 sm:px-6">
            <SkeletonBlock className="h-5 w-40" />
            <SkeletonBlock className="h-20 w-full max-w-2xl" />
            <SkeletonBlock className="h-20 w-full max-w-xl" />
            <SkeletonBlock className="mt-auto h-14 w-full" />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh min-h-0 w-full min-w-0 overflow-x-hidden bg-background" data-app-shell="ready">
      {sidebar}
      <main className="v2-app-surface relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          {toolbar}
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </main>
    </div>
  )
}
