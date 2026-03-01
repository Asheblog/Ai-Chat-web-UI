'use client'

import { CheckCircle2, Clock3, Loader2, Octagon, Shield, XCircle } from 'lucide-react'
import type { ToolEvent } from '@/types'

const formatToolName = (tool: string | undefined) => {
  if (!tool) return '工具调用'
  if (tool === 'web_search') return '联网搜索'
  if (tool === 'python_runner') return 'Python 工具'
  if (tool === 'read_url') return '网页读取'
  if (tool === 'document_search') return '文档搜索'
  if (tool === 'document_list') return '文档列表'
  if (tool === 'kb_search') return '知识库搜索'
  if (tool.startsWith('workspace_')) return '工作区工具'
  return tool
}

const statusMeta: Record<
  ToolEvent['status'],
  { label: string; icon: typeof Loader2; className: string }
> = {
  running: {
    label: '执行中',
    icon: Loader2,
    className: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  },
  success: {
    label: '完成',
    icon: CheckCircle2,
    className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  },
  pending: {
    label: '待审批',
    icon: Clock3,
    className: 'bg-amber-500/10 text-amber-600 dark:text-amber-300',
  },
  error: {
    label: '失败',
    icon: XCircle,
    className: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  },
  rejected: {
    label: '已拒绝',
    icon: Shield,
    className: 'bg-orange-500/10 text-orange-600 dark:text-orange-300',
  },
  aborted: {
    label: '已中止',
    icon: Octagon,
    className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  },
}

const resolvePrimaryText = (event: ToolEvent) => {
  if (event.status === 'error' || event.status === 'rejected' || event.status === 'aborted') {
    return event.error || event.summary || '调用未成功'
  }
  if (event.summary) return event.summary
  if (event.status === 'pending') return '等待工具审批后执行'
  if (event.status === 'running') return '工具执行中'
  return event.resultText || '工具调用完成'
}

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

const resolveDiagnosticText = (event: ToolEvent) => {
  const errorCode = pickString(event.details?.errorCode, event.details?.code)
  const httpStatus =
    typeof event.details?.httpStatus === 'number' && Number.isFinite(event.details.httpStatus)
      ? event.details.httpStatus
      : null
  const fallbackUsed = pickString(event.details?.fallbackUsed)
  const parts: string[] = []
  if (errorCode) parts.push(`错误码: ${errorCode}`)
  if (httpStatus != null) parts.push(`HTTP: ${httpStatus}`)
  if (fallbackUsed) parts.push(`回退: ${fallbackUsed}`)
  return parts.join(' · ')
}

const formatClock = (timestamp: number) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

interface ToolCallCardProps {
  event: ToolEvent
}

export function ToolCallCard({ event }: ToolCallCardProps) {
  const meta = statusMeta[event.status]
  const StatusIcon = meta.icon
  const toolLabel = formatToolName(event.identifier || event.apiName || event.tool)
  const primaryText = resolvePrimaryText(event)
  const argumentText = pickString(
    event.argumentsText,
    event.details?.argumentsText,
    event.details?.input,
    event.query,
  )
  const resultText = pickString(
    event.resultText,
    event.details?.resultText,
    event.details?.stdout,
  )
  const diagnosticText = resolveDiagnosticText(event)
  const eventUrl = pickString(event.details?.url)
  const eventTitle = pickString(event.details?.title) || eventUrl

  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{toolLabel}</span>
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${meta.className}`}>
            <StatusIcon className={`h-3.5 w-3.5 ${event.status === 'running' ? 'animate-spin' : ''}`} />
            {meta.label}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatClock(event.updatedAt ?? event.createdAt)}</span>
      </div>
      <p className="mt-1 break-words text-xs text-muted-foreground">{primaryText}</p>
      {diagnosticText && (
        <p className="mt-1 break-words rounded bg-background/80 px-2 py-1 text-[11px] text-muted-foreground">
          诊断: {diagnosticText}
        </p>
      )}
      {argumentText && (
        <p className="mt-1 break-words rounded bg-background/80 px-2 py-1 font-mono text-[11px] text-muted-foreground">
          参数: {argumentText}
        </p>
      )}
      {resultText && event.status !== 'running' && event.status !== 'pending' && (
        <p className="mt-1 break-words rounded bg-background/80 px-2 py-1 text-[11px] text-muted-foreground">
          结果: {resultText}
        </p>
      )}
      {eventUrl && (
        <a
          href={eventUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block max-w-full truncate text-[11px] text-primary hover:underline"
          title={eventUrl}
        >
          来源: {eventTitle}
        </a>
      )}
    </div>
  )
}
