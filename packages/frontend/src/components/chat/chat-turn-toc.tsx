'use client'

import { cn } from '@/lib/utils'
import type { TurnTocEntry } from '@/features/chat/reading-nav'

export interface ChatTurnTocProps {
  entries: TurnTocEntry[]
  activeKey: string | null
  onJump: (key: string) => void
  className?: string
}

export function ChatTurnToc({ entries, activeKey, onJump, className }: ChatTurnTocProps) {
  if (entries.length === 0) return null

  return (
    <nav
      aria-label="对话轮次目录"
      className={cn(
        'pointer-events-none absolute inset-y-0 right-0 z-20 hidden w-8 md:block',
        className,
      )}
    >
      <div className="pointer-events-auto absolute right-1.5 top-1/2 flex max-h-[min(70vh,28rem)] -translate-y-1/2 flex-col justify-center">
        <ul className="group/toc flex flex-col items-end gap-2 py-1">
          {entries.map((entry) => {
            const active = entry.key === activeKey
            return (
              <li key={entry.key} className="relative flex justify-end">
                <button
                  type="button"
                  title={entry.label}
                  aria-current={active ? 'true' : undefined}
                  aria-label={`跳转到：${entry.label}`}
                  onClick={() => onJump(entry.key)}
                  className={cn(
                    'flex items-center justify-end gap-2 rounded-md py-0.5 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none absolute right-5 top-1/2 max-w-[12rem] -translate-y-1/2 truncate whitespace-nowrap rounded-md bg-[hsl(var(--background))]/95 px-2 py-0.5 text-xs leading-5 opacity-0 shadow-none',
                      'transition-opacity group-hover/toc:opacity-100 group-focus-within/toc:opacity-100',
                      active && 'font-medium',
                    )}
                  >
                    {entry.label}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'relative z-10 h-0.5 shrink-0 rounded-full transition-all',
                      active ? 'w-3.5 bg-primary' : 'w-2.5 bg-border group-hover/toc:bg-muted-foreground/45',
                    )}
                  />
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
