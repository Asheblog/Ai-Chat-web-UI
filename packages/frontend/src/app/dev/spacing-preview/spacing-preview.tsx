'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChatMessageViewport } from '@/components/chat/chat-message-viewport'
import { ProcessWorkspaceHost } from '@/features/chat/process-workspace'
import { useChatStore } from '@/store/chat-store'
import type { MessageBody, MessageMeta } from '@/types'

const sessionId = -1511
const createdAt = '2026-11-15T12:20:00Z'
const question = '查询今日中国新闻，按主题整理要点，并附上来源和发布时间。'
const answer = '我会先检索今天的相关新闻，再按主题整理要点，并附上来源和发布时间。每条新闻保留标题、核心信息、发布时间与原文链接，方便继续追问和核对。'

export function SpacingPreview() {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const [long, setLong] = useState(false)
  const [dark, setDark] = useState(false)
  const [state, setState] = useState<'done' | 'streaming' | 'empty' | 'error'>('done')
  const metas = useMemo<MessageMeta[]>(() => state === 'empty' ? [] : [
    { id: -151101, stableKey: 'spacing-question', sessionId, role: 'user', createdAt },
    { id: -151102, stableKey: 'spacing-answer', sessionId, role: 'assistant', createdAt, streamStatus: state === 'error' ? 'error' : state === 'streaming' ? 'streaming' : 'done' },
  ], [state])

  useEffect(() => {
    const previous = useChatStore.getState().messageBodies
    const bodies: Record<string, MessageBody> = {
      '-151101': { id: -151101, stableKey: 'spacing-question', content: long ? question.repeat(8) : question, version: 1, reasoningVersion: 1 },
      '-151102': { id: -151102, stableKey: 'spacing-answer', content: state === 'streaming' || state === 'error' ? '' : long ? Array.from({ length: 30 }, (_, i) => (i + 1) + '. ' + answer).join('\n\n') : answer, version: 1, reasoningVersion: 1 },
    }
    useChatStore.setState({ messageBodies: { ...previous, ...bodies } })
    setReady(true)
    return () => { useChatStore.setState({ messageBodies: previous }) }
  }, [long, state])

  useEffect(() => {
    const previous = document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', dark)
    return () => { document.documentElement.classList.toggle('dark', previous) }
  }, [dark])

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-background px-4 py-3" data-preview-header>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <h1 className="mr-auto font-medium">查询今日中国新闻</h1>
          <label className="flex items-center gap-1"><input type="checkbox" checked={long} onChange={e => setLong(e.target.checked)} />长消息</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)} />深色</label>
          <select aria-label="预览消息状态" className="rounded border border-border bg-background p-1" value={state} onChange={e => setState(e.target.value as typeof state)}>
            <option value="done">已完成</option><option value="streaming">运行中</option><option value="empty">空消息</option><option value="error">出错</option>
          </select>
        </div>
      </header>
      <ProcessWorkspaceHost className="flex min-h-0 flex-1">
        {ready && <ChatMessageViewport scrollAreaRef={scrollAreaRef} error={null} metas={metas} isStreaming={state === 'streaming'} isLoading={false} isAutoScrollEnabled={false} variantSelections={{}} sessionId={sessionId} sessionTitle="查询今日中国新闻" />}
      </ProcessWorkspaceHost>
      <footer className="shrink-0 px-4 pb-5 pt-3 md:px-6">
        <div className="rounded-[16px] border border-border bg-surface p-4">
          <textarea aria-label="继续提问" placeholder="继续提问…" className="h-14 w-full resize-none bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground"><span>＋　联网</span><span>DeepSeek</span></div>
        </div>
      </footer>
    </main>
  )
}
