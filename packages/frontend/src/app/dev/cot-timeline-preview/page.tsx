'use client'

import { useMemo } from 'react'
import { notFound } from 'next/navigation'
import { CotTimeline } from '@/components/message-bubble/cot-timeline'
import { buildMockReasoning, buildMockToolEvents, createMockMeta } from './mock-data'

/** 预览用的消息 key：?level=outline 时给这几条预置折叠级别，方便一屏对照三态 */
const PREVIEW_ITEM_KEYS = ['preview-done', 'preview-streaming', 'preview-reasoning-only']

if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search)
  const level = params.get('level')
  if (level === 'collapsed' || level === 'outline' || level === 'expanded') {
    for (const key of PREVIEW_ITEM_KEYS) {
      window.sessionStorage.setItem(
        `aichat.cot_timeline_level:${key}`,
        JSON.stringify({ level, updatedAt: Date.now() }),
      )
    }
  }
  if (params.get('theme') === 'dark') {
    document.documentElement.classList.add('dark')
  }
}

/**
 * 仅开发环境使用的时间轴三段折叠预览页。
 * 生产构建直接 404，避免成为正式路由。
 */
export default function CotTimelinePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const { reasoningRaw } = useMemo(() => buildMockReasoning(), [])
  const toolEvents = useMemo(() => buildMockToolEvents(), [])

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-1">
          <h1 className="text-title-l">过程时间轴 · 三段折叠预览</h1>
          <p className="text-sm text-muted-foreground">
            L0 一行摘要 → L1 提纲（限高滚动，可单步下钻）→ L2 全部展开。仅 dev 可见。
          </p>
        </header>

        <section className="space-y-2" data-testid="case-done">
          <h2 className="text-sm font-medium text-muted-foreground">完成态 · 127 步（默认 L0）</h2>
          <CotTimeline
            meta={createMockMeta({ stableKey: 'preview-done' })}
            reasoningRaw={reasoningRaw}
            toolEvents={toolEvents}
          />
          <p className="text-xs text-muted-foreground">
            上面这一行就是正文之前占用的全部高度；点它进入提纲层。
          </p>
        </section>

        <section className="space-y-2" data-testid="case-streaming">
          <h2 className="text-sm font-medium text-muted-foreground">流式态 · 自动 L1</h2>
          <CotTimeline
            meta={createMockMeta({
              stableKey: 'preview-streaming',
              reasoningStatus: 'streaming',
              reasoningDurationSeconds: undefined,
            })}
            reasoningRaw={reasoningRaw}
            toolEvents={toolEvents.slice(0, 80)}
            isStreaming
            reasoningPlayedLength={reasoningRaw.length}
          />
        </section>

        <section className="space-y-2" data-testid="case-reasoning-only">
          <h2 className="text-sm font-medium text-muted-foreground">只有思考 · 无工具</h2>
          <CotTimeline
            meta={createMockMeta({ stableKey: 'preview-reasoning-only' })}
            reasoningRaw={reasoningRaw}
            toolEvents={[]}
          />
        </section>

        <section className="space-y-2" data-testid="case-empty">
          <h2 className="text-sm font-medium text-muted-foreground">空态 · 不渲染</h2>
          <CotTimeline
            meta={createMockMeta({ stableKey: 'preview-empty' })}
            reasoningRaw=""
            toolEvents={[]}
          />
          <p className="text-xs text-muted-foreground">空态整块消失，不占位。</p>
        </section>
      </div>
    </main>
  )
}
