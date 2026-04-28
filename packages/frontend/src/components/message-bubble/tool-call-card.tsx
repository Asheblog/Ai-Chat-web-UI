'use client'

import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Image as ImageIcon,
  Loader2,
  Octagon,
  Shield,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
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
  { label: string; icon: LucideIcon; className: string }
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

const stringifyDetail = (value: unknown) => {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const resolveDiagnosticText = (event: ToolEvent) => {
  const errorCode = pickString(event.details?.errorCode)
  const httpStatus =
    typeof event.details?.httpStatus === 'number' && Number.isFinite(event.details.httpStatus)
      ? event.details.httpStatus
      : null
  const exitCode =
    typeof event.details?.exitCode === 'number' && Number.isFinite(event.details.exitCode)
      ? event.details.exitCode
      : null
  const fallbackUsed = pickString(event.details?.fallbackUsed)
  const warning = pickString(event.details?.warning)
  const parts: string[] = []
  if (errorCode) parts.push(`错误码: ${errorCode}`)
  if (httpStatus != null) parts.push(`HTTP: ${httpStatus}`)
  if (exitCode != null) parts.push(`退出码: ${exitCode}`)
  if (fallbackUsed) parts.push(`回退: ${fallbackUsed}`)
  if (warning) parts.push(`警告: ${warning}`)
  if (event.details?.truncated) parts.push('输出已截断')
  return parts.join(' · ')
}

const toLanguageLabel = (value: string | null) => {
  if (!value) return null
  if (value === 'zh') return '中文'
  if (value === 'en') return 'English'
  if (value === 'unknown') return '未知语言'
  return value
}

const formatClock = (timestamp: number) => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const formatDuration = (durationMs: unknown) => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`
  return `${Math.round(durationMs)}ms`
}

interface ToolCallCardProps {
  event: ToolEvent
}

interface DetailBlockProps {
  title: string
  children: string
  mono?: boolean
}

function DetailBlock({ title, children, mono = false }: DetailBlockProps) {
  if (!children) return null
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <pre
        className={cn(
          'max-h-[32vh] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-border bg-muted/40 px-3 py-2.5 text-xs leading-5 text-foreground [overflow-wrap:anywhere]',
          mono && 'font-mono text-[11px]',
        )}
      >
        {children}
      </pre>
    </section>
  )
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
    event.details?.code,
    event.query,
  )
  const resultText = pickString(
    event.resultText,
    event.details?.resultText,
    event.details?.stdout,
  ) || stringifyDetail(event.resultJson ?? event.details?.resultJson)
  const diagnosticText = resolveDiagnosticText(event)
  const stderrText = pickString(event.details?.stderr)
  const eventUrl = pickString(event.details?.url)
  const eventTitle = pickString(event.details?.title) || eventUrl
  const leadImageUrl = pickString(event.details?.leadImageUrl)
  const imageCount = Array.isArray(event.details?.images) ? event.details.images.length : 0
  const engine = pickString(event.details?.engine)
  const language = toLanguageLabel(pickString(event.details?.queryLanguage))
  const taskType = pickString(event.details?.taskType)
  const expandedQuery = pickString(event.details?.expandedQuery)
  const duration = formatDuration(event.details?.durationMs)
  const contextTags = [
    engine ? `引擎: ${engine}` : null,
    language ? `语言: ${language}` : null,
    taskType ? `任务: ${taskType}` : null,
    duration ? `耗时: ${duration}` : null,
    typeof event.details?.hitsCount === 'number' ? `${event.details.hitsCount} 条结果` : null,
    expandedQuery ? `查询: ${expandedQuery}` : null,
  ].filter((item): item is string => Boolean(item))
  const visibleContextTags = contextTags.slice(0, 3)
  const detailDescription = [primaryText, contextTags.join(' · ')].filter(Boolean).join(' · ')
  const detailIdText = [event.callId ? `Call ID: ${event.callId}` : null, `事件: ${event.id}`]
    .filter(Boolean)
    .join(' · ')
  const diagnostics = [diagnosticText, event.error, stderrText].filter(Boolean).join('\n')

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center gap-3 rounded-[8px] border border-border bg-card px-3 py-2.5 text-left transition-colors duration-200 hover:border-primary/30 hover:bg-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2"
          aria-label={`查看${toolLabel}工具调用详情`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
            <StatusIcon className={`h-4 w-4 ${event.status === 'running' ? 'animate-spin' : ''}`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">{toolLabel}</span>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${meta.className}`}>
                {meta.label}
              </span>
              <span className="ml-auto hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                {formatClock(event.updatedAt ?? event.createdAt)}
              </span>
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{primaryText}</span>
            {visibleContextTags.length > 0 && (
              <span className="mt-1 hidden min-w-0 flex-wrap gap-1.5 sm:flex">
                {visibleContextTags.map((tag) => (
                  <span key={tag} className="max-w-[220px] truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </span>
            )}
          </span>
          {leadImageUrl && (
            <span className="hidden h-10 w-14 shrink-0 overflow-hidden rounded-[8px] border border-border bg-muted/40 sm:block">
              <img src={leadImageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors group-hover:text-primary">
            <span className="hidden sm:inline">详情</span>
            <ChevronRight className="h-4 w-4" />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="bottom-0 left-0 top-auto flex h-[88dvh] max-h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-b-none rounded-t-[14px] border-border bg-card p-0 shadow-[0_-20px_70px_hsl(var(--background)/0.55)] sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[86vh] sm:w-[92vw] sm:max-w-[900px] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-[10px] sm:shadow-[0_28px_80px_hsl(var(--background)/0.55)]">
        <DialogHeader className="border-b border-border px-4 py-4 pr-12 text-left sm:px-5">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
              <StatusIcon className={`h-4 w-4 ${event.status === 'running' ? 'animate-spin' : ''}`} />
            </span>
            <span className="min-w-0 truncate">{toolLabel}</span>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${meta.className}`}>
              {meta.label}
            </span>
          </DialogTitle>
          <DialogDescription className="line-clamp-2 text-xs leading-5 text-muted-foreground">
            {detailDescription || '参数、诊断与结果'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mb-4 grid gap-2 rounded-[8px] border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground sm:grid-cols-2">
            <div className="min-w-0">
              <span className="text-muted-foreground">时间</span>
              <p className="mt-1 truncate font-medium text-foreground">{formatClock(event.updatedAt ?? event.createdAt) || '未知'}</p>
            </div>
            <div className="min-w-0">
              <span className="text-muted-foreground">标识</span>
              <p className="mt-1 truncate font-mono text-[11px] text-foreground" title={detailIdText}>
                {detailIdText}
              </p>
            </div>
            {contextTags.length > 0 && (
              <div className="min-w-0 sm:col-span-2">
                <span className="text-muted-foreground">上下文</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {contextTags.map((tag) => (
                    <span key={tag} className="max-w-full truncate rounded bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <DetailBlock title="调用参数" mono>
              {argumentText || '无参数内容'}
            </DetailBlock>
            {diagnostics && (
              <DetailBlock title="诊断信息" mono>
                {diagnostics}
              </DetailBlock>
            )}
            {resultText && event.status !== 'running' && event.status !== 'pending' && (
              <DetailBlock title="执行结果" mono>
                {resultText}
              </DetailBlock>
            )}
            {leadImageUrl && (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">来源预览</h4>
                <div className="rounded-[8px] border border-border bg-muted/40 p-2">
                  <img
                    src={leadImageUrl}
                    alt={eventTitle || '工具调用来源图片'}
                    className="max-h-56 w-full rounded-[6px] object-contain"
                    loading="lazy"
                  />
                  <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <ImageIcon className="h-3.5 w-3.5" />
                    主图{imageCount > 1 ? ` · 共 ${imageCount} 张` : ''}
                  </p>
                </div>
              </section>
            )}
            {eventUrl && (
              <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">来源链接</h4>
                <a
                  href={eventUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 rounded-[8px] border border-border bg-card px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-accent"
                  title={eventUrl}
                >
                  <span className="truncate">{eventTitle}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                </a>
              </section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
