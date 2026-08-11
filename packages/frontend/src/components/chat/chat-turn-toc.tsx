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
        'pointer-events-none absolute inset-y-0 right-0 z-20 hidden overflow-visible md:block',
        className,
      )}
    >
      {/*
        DeepSeek 式悬浮面板：常显标签 + 右侧刻度，约可舒适容纳 20 个汉字。
        右对齐，避免挤占对话栏；纵向滚动放在面板自身。
      */}
      <div className="pointer-events-auto absolute right-3 top-1/2 flex max-h-[min(72vh,32rem)] -translate-y-1/2 justify-end overflow-visible">
        <ul
          className={cn(
            'flex w-[22rem] max-h-[min(72vh,32rem)] flex-col gap-2.5 overflow-y-auto rounded-2xl',
            'bg-[hsl(var(--background))] py-3 pl-4 pr-3',
            'shadow-[0_8px_28px_rgba(15,23,42,0.12)] ring-1 ring-border/50',
          )}
        >
          {entries.map((entry) => {
            const active = entry.key === activeKey
            return (
              <li key={entry.key} className="flex w-full min-w-0 justify-end">
                <button
                  type="button"
                  title={entry.label}
                  aria-current={active ? 'true' : undefined}
                  aria-label={`跳转到：${entry.label}`}
                  onClick={() => onJump(entry.key)}
                  className={cn(
                    'flex w-full min-w-0 items-center justify-end gap-3 rounded-md py-0.5 text-left',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm leading-6',
                      active && 'font-medium',
                    )}
                  >
                    {entry.label}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'h-0.5 shrink-0 rounded-full',
                      active ? 'w-4 bg-primary' : 'w-2.5 bg-border',
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
