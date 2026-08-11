'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { TurnTocEntry } from '@/features/chat/reading-nav'

export interface ChatTurnTocProps {
  entries: TurnTocEntry[]
  activeKey: string | null
  onJump: (key: string) => void
  className?: string
}

export function ChatTurnToc({ entries, activeKey, onJump, className }: ChatTurnTocProps) {
  const [expanded, setExpanded] = useState(false)

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
        DS 交互：默认只露右侧刻度；悬停/聚焦时向左弹出宽面板显示标题。
        纵向滚动只在展开后的全宽面板上开启，避免 overflow-y 连带裁剪横向。
      */}
      <div className="pointer-events-auto absolute right-2 top-1/2 flex -translate-y-1/2 justify-end overflow-visible">
        <ul
          onMouseEnter={() => setExpanded(true)}
          onMouseLeave={() => setExpanded(false)}
          onFocusCapture={() => setExpanded(true)}
          onBlurCapture={(event) => {
            const next = event.relatedTarget
            if (next instanceof Node && event.currentTarget.contains(next)) return
            setExpanded(false)
          }}
          className={cn(
            'flex flex-col gap-2.5 rounded-2xl transition-[width,padding,background-color,box-shadow] duration-150 ease-out',
            expanded
              ? 'max-h-[min(72vh,32rem)] w-[22rem] overflow-y-auto bg-[hsl(var(--background))] py-3 pl-4 pr-3 shadow-[0_8px_28px_rgba(15,23,42,0.12)] ring-1 ring-border/50'
              : 'w-8 overflow-visible py-2 pr-1.5',
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
                    'flex min-w-0 items-center justify-end rounded-md py-0.5 text-left',
                    expanded ? 'w-full gap-3' : 'gap-0',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'truncate text-sm leading-6 transition-opacity duration-150',
                      expanded ? 'min-w-0 flex-1 opacity-100' : 'sr-only',
                      active && expanded && 'font-medium',
                    )}
                  >
                    {entry.label}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'shrink-0 rounded-full transition-all duration-150',
                      active ? 'h-0.5 w-4 bg-primary' : 'h-0.5 w-2.5 bg-border',
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
