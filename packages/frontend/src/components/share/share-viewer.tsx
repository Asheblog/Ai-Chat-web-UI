'use client'

import { useState, useMemo } from 'react'
import type { ChatShare, ToolEvent } from '@/types'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { ReasoningPanel } from '@/components/reasoning-panel'
import { cn, formatDate } from '@/lib/utils'
import { User, Bot } from 'lucide-react'

interface ShareViewerProps {
  share: ChatShare
  brandText?: string
}

/** 格式化相对时间 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 7) return `${diffDays} 天前`

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

/** 根据 toolEvents 生成工具摘要 */
function buildToolSummary(toolEvents?: ToolEvent[]) {
  if (!toolEvents || toolEvents.length === 0) return null

  const toolCounts = new Map<string, number>()
  let success = 0
  let running = 0
  let error = 0

  toolEvents.forEach((event) => {
    toolCounts.set(event.tool, (toolCounts.get(event.tool) || 0) + 1)
    if (event.status === 'success') success++
    else if (event.status === 'running') running++
    else if (event.status === 'error') error++
  })

  const parts: string[] = []
  if (success > 0) parts.push(`完成 ${success} 次`)
  if (running > 0) parts.push(`进行中 ${running} 次`)
  if (error > 0) parts.push(`失败 ${error} 次`)

  const describeTool = (tool: string) => {
    if (tool === 'web_search') return '联网搜索'
    if (tool === 'python_runner') return 'Python 工具'
    if (tool === 'document_search') return '文档搜索'
    if (tool === 'kb_search') return '知识库搜索'
    return tool
  }

  const labelParts = Array.from(toolCounts.entries()).map(
    ([tool, count]) => `${describeTool(tool)} ${count} 次`
  )

  return {
    total: toolEvents.length,
    summaryText: parts.join(' · ') || '等待工具结果',
    label: labelParts.length > 0 ? labelParts.join(' / ') : '工具调用',
  }
}

interface ShareMessageItemProps {
  msg: ChatShare['messages'][number]
  defaultReasoningExpanded?: boolean
}

function ShareMessageItem({ msg, defaultReasoningExpanded = false }: ShareMessageItemProps) {
  const [reasoningExpanded, setReasoningExpanded] = useState(defaultReasoningExpanded)

  const hasReasoning = msg.reasoning && msg.reasoning.trim().length > 0
  const toolEvents = (msg as { toolEvents?: ToolEvent[] }).toolEvents
  const toolSummary = useMemo(() => buildToolSummary(toolEvents), [toolEvents])
  const hasReasoningSection = hasReasoning || (toolEvents && toolEvents.length > 0)

  const isUser = msg.role === 'user'

  return (
    <article
      className={cn(
        'rounded-xl border shadow-sm overflow-hidden',
        isUser ? 'bg-muted/40' : 'bg-background',
      )}
    >
      {/* 消息头部 */}
      <div className="flex items-center justify-between border-b px-4 py-2.5 bg-muted/20">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full',
              isUser ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-600'
            )}
          >
            {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </div>
          <span className="font-medium text-sm text-foreground">
            {isUser ? '用户' : 'AI 助手'}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{formatDate(msg.createdAt)}</span>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* 思维链面板 - 在消息内容上方，默认折叠 */}
        {!isUser && hasReasoningSection && (
          <ReasoningPanel
            status="done"
            durationSeconds={null}
            idleMs={null}
            expanded={reasoningExpanded}
            onToggle={() => setReasoningExpanded(!reasoningExpanded)}
            reasoningRaw={msg.reasoning || ''}
            reasoningHtml={undefined}
            isStreaming={false}
            toolSummary={toolSummary}
            toolTimeline={toolEvents || []}
          />
        )}

        {/* 消息正文内容 */}
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <MarkdownRenderer html={null} fallback={msg.content} />
        </div>

        {/* 图片区域 */}
        {msg.images && msg.images.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {msg.images.map((src, index) => (
              <img
                key={`${src}-${index}`}
                src={src}
                alt="分享图片"
                className="max-h-48 w-full rounded-md object-contain border bg-white"
              />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

export function ShareViewer({ share, brandText = 'AIChat' }: ShareViewerProps) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* 主内容区 */}
      <div className="flex-1 w-full px-4 md:px-6 lg:px-8 py-8">
        {/* 简化的页头 */}
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2">
            {share.title || share.sessionTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatRelativeTime(share.createdAt)} · {share.messageCount} 条消息
          </p>
        </header>

        {/* 消息列表 */}
        <section className="space-y-4">
          {share.messages.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
              分享中暂无可展示的内容
            </div>
          ) : (
            share.messages.map((msg) => (
              <ShareMessageItem
                key={`${msg.id}-${msg.createdAt}`}
                msg={msg}
                defaultReasoningExpanded={false}
              />
            ))
          )}
        </section>
      </div>

      {/* 页脚 */}
      <footer className="border-t bg-muted/30 py-4">
        <div className="w-full px-4 md:px-6 lg:px-8 text-center text-xs text-muted-foreground">
          本页面分享由 <span className="font-medium text-foreground">{brandText}</span> 系统生成
        </div>
      </footer>
    </div>
  )
}
