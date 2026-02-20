'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { Brain, ChevronDown, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToolEvent, ToolEventDetails } from '@/types'
import { TypewriterReasoning } from './typewriter-reasoning'

const formatToolName = (tool: string | undefined) => {
  if (!tool) return '工具'
  if (tool === 'web_search') return '联网搜索'
  if (tool === 'python_runner') return 'Python 工具'
  return tool
}

interface PythonToolCallItem {
  id: string
  createdAt: number
  finishedAt?: number
  status: ToolEvent['status']
  startSummary?: string
  resultSummary?: string
  error?: string
  details?: ToolEventDetails
}

const pythonStatusLabel: Record<ToolEvent['status'], string> = {
  success: '完成',
  running: '执行中',
  error: '失败',
}

const mergeToolDetails = (prev?: ToolEventDetails, next?: ToolEventDetails): ToolEventDetails | undefined => {
  if (!prev && !next) return undefined
  return {
    ...(prev ?? {}),
    ...(next ?? {}),
  }
}

const aggregatePythonCalls = (events: ToolEvent[]): PythonToolCallItem[] => {
  const map = new Map<string, PythonToolCallItem>()
  events.forEach((event) => {
    if (event.tool !== 'python_runner') return
    let call = map.get(event.id)
    if (!call) {
      call = {
        id: event.id,
        createdAt: event.createdAt,
        status: event.status ?? 'running',
      }
      map.set(event.id, call)
    }
    call.createdAt = Math.min(call.createdAt, event.createdAt)
    if (event.stage === 'start') {
      call.status = 'running'
      if (event.summary) call.startSummary = event.summary
    } else if (event.stage === 'result') {
      call.status = 'success'
      call.resultSummary = event.summary ?? call.resultSummary
      call.finishedAt = event.createdAt
    } else if (event.stage === 'error') {
      call.status = 'error'
      call.error = event.error || event.summary || call.error
      call.finishedAt = event.createdAt
    }
    call.details = mergeToolDetails(call.details, event.details)
  })
  return Array.from(map.values()).sort((a, b) => a.createdAt - b.createdAt)
}

const extractFirstMeaningfulLine = (input?: string) => {
  if (!input) return null
  const lines = input.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

const clampText = (text: string, limit = 80) => {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

const resolvePythonCallTitle = (call: PythonToolCallItem) => {
  if (call.startSummary) return clampText(call.startSummary, 100)
  const firstLine = extractFirstMeaningfulLine(call.details?.code)
  if (firstLine) return clampText(firstLine, 100)
  return 'Python 调用'
}

const resolvePythonCallSubtitle = (call: PythonToolCallItem) => {
  if (call.status === 'error') {
    return clampText(call.error ?? '执行失败', 100)
  }
  if (call.status === 'success') {
    const primary = call.resultSummary ?? extractFirstMeaningfulLine(call.details?.stdout)
    return primary ? clampText(primary, 100) : '执行完成，点击查看输出'
  }
  return '执行中，点击查看代码与输出'
}

const formatDurationText = (durationMs?: number) => {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) return '—'
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(2)}s`
}

interface ReasoningPanelProps {
  status?: 'idle' | 'streaming' | 'done'
  durationSeconds?: number | null
  idleMs?: number | null
  expanded: boolean
  onToggle: () => void
  reasoningRaw: string
  reasoningHtml?: string
  reasoningPlayedLength?: number
  isStreaming: boolean
  toolSummary: { total: number; summaryText: string; label: string } | null
  toolTimeline: ToolEvent[]
}

const statusTextMap: Record<NonNullable<ReasoningPanelProps['status']>, string> = {
  idle: '正在思考',
  streaming: '输出中',
  done: '推理完成',
}

function ReasoningPanelComponent({
  status,
  durationSeconds,
  idleMs,
  expanded,
  onToggle,
  reasoningRaw,
  reasoningHtml,
  reasoningPlayedLength,
  isStreaming,
  toolSummary,
  toolTimeline,
}: ReasoningPanelProps) {
  const [toolTimelineOpen, setToolTimelineOpen] = useState(false)
  const [activePythonCallId, setActivePythonCallId] = useState<string | null>(null)

  const pythonCalls = useMemo(() => aggregatePythonCalls(toolTimeline), [toolTimeline])
  const otherToolEvents = useMemo(
    () => toolTimeline.filter((event) => event.tool !== 'python_runner'),
    [toolTimeline],
  )

  const activePythonCall = useMemo(() => {
    if (!activePythonCallId) return null
    return pythonCalls.find((call) => call.id === activePythonCallId) ?? null
  }, [activePythonCallId, pythonCalls])

  useEffect(() => {
    if (!activePythonCallId) return
    if (!pythonCalls.some((call) => call.id === activePythonCallId)) {
      setActivePythonCallId(null)
    }
  }, [activePythonCallId, pythonCalls])

  const hasReasoning = reasoningRaw.trim().length > 0 || Boolean(reasoningHtml)
  const placeholderText =
    status === 'streaming'
      ? '推理内容接收中…'
      : status === 'idle'
        ? '正在思考中…'
        : '暂无推理内容'

  // 检测打字机动画是否仍在播放
  // 当 reasoningStatus 已是 done 但打字机尚未播放完所有内容时，状态栏应显示"输出中"
  const typewriterStillPlaying = useMemo(() => {
    if (status !== 'done') return false
    if (!hasReasoning) return false
    const totalLength = reasoningRaw.length
    const playedLength = typeof reasoningPlayedLength === 'number' ? reasoningPlayedLength : totalLength
    // 如果还有未播放的内容，说明打字机动画仍在进行
    return playedLength < totalLength
  }, [status, hasReasoning, reasoningRaw.length, reasoningPlayedLength])

  // 显示状态：如果打字机动画还在播放，显示 "输出中" 而非 "推理完成"
  const displayStatus = typewriterStillPlaying ? 'streaming' : status
  const statusLabel = displayStatus ? statusTextMap[displayStatus] : '思维过程'
  const durationLabel =
    typeof durationSeconds === 'number' && durationSeconds > 0
      ? `用时 ${durationSeconds}s`
      : null
  const idleLabel =
    status === 'idle' && typeof idleMs === 'number' && idleMs > 0
      ? `静默 ${Math.round(idleMs / 1000)}s`
      : null

  const headerSubtitle = useMemo(() => {
    // 如果打字机动画还在播放，显示动态提示
    if (typewriterStillPlaying) return '正在整理答案'
    if (durationLabel) return durationLabel
    if (idleLabel) return idleLabel
    if (status === 'streaming') return '正在整理答案'
    if (status === 'idle') return '准备推理中'
    return '查看模型推理轨迹'
  }, [typewriterStillPlaying, durationLabel, idleLabel, status])

  return (
    <div className={`reasoning-panel${expanded ? ' reasoning-panel--expanded' : ''}`}>
      <button
        type="button"
        className="reasoning-header"
        onClick={onToggle}
        aria-expanded={expanded}
        title="思维链（可折叠）"
      >
        <span className="reasoning-header__left">
          <span className={`reasoning-status-icon ${displayStatus ?? 'none'}`}>
            {displayStatus === 'streaming' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
          </span>
          <span>
            <span className="reasoning-header__title">{statusLabel}</span>
            <span className="reasoning-header__subtitle">{headerSubtitle}</span>
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <>
          {status === 'idle' && (
            <div className="reasoning-hint">
              模型正在思考…
              {idleLabel ? `（${idleLabel}）` : null}
            </div>
          )}

          <div className="reasoning-timeline">
            {hasReasoning ? (
              // 流式传输时始终使用 TypewriterReasoning，避免中途切换到预渲染HTML导致视觉跳转
              // 只有在非流式且有预渲染HTML时才使用 dangerouslySetInnerHTML
              !isStreaming && reasoningHtml ? (
                <div
                  className="markdown-body markdown-body--reasoning reasoning-markdown"
                  dangerouslySetInnerHTML={{ __html: reasoningHtml }}
                />
              ) : (
                <div className="reasoning-item reasoning-markdown--typewriter">
                  <TypewriterReasoning
                    text={reasoningRaw}
                    isStreaming={isStreaming}
                    initialPlayedLength={reasoningPlayedLength}
                    speed={20}
                  />
                </div>
              )
            ) : (
              <div className="reasoning-placeholder">{placeholderText}</div>
            )}
          </div>

          {toolSummary && (
            <div className="reasoning-tools">
              <div className="reasoning-tools__header">
                <div>
                  <div className="reasoning-tools__title">
                    {toolSummary.label} · {toolSummary.total} 次
                  </div>
                  <p className="reasoning-tools__desc">{toolSummary.summaryText}</p>
                </div>
                {toolTimeline.length > 0 && (
                  <button
                    type="button"
                    className="reasoning-tools__toggle"
                    onClick={() => setToolTimelineOpen((prev) => !prev)}
                  >
                    {toolTimelineOpen ? '收起详情' : '展开详情'}
                  </button>
                )}
              </div>
              {toolTimelineOpen && (
                <div className="reasoning-tools__timeline">
                  {pythonCalls.length > 0 && (
                    <div className="python-tools">
                      <p className="python-tools__intro">Python 工具调用（{pythonCalls.length}）</p>
                      <div className="python-tools__list">
                        {pythonCalls.map((call) => {
                          const title = resolvePythonCallTitle(call)
                          const subtitle = resolvePythonCallSubtitle(call)
                          return (
                            <button
                              key={call.id}
                              type="button"
                              className="python-tools__item"
                              disabled={call.status === 'running'}
                              onClick={() => {
                                if (call.status === 'running') return
                                setActivePythonCallId(call.id)
                              }}
                            >
                              <span className="python-tools__item-text">
                                <span className="python-tools__item-title">{title}</span>
                                <span className="python-tools__item-desc">{subtitle}</span>
                              </span>
                              <span className={`python-tools__status python-tools__status--${call.status}`}>
                                {pythonStatusLabel[call.status]}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {otherToolEvents.map((event) => {
                    const toolLabel = formatToolName(event.tool)
                    const primaryText = event.query || event.summary || toolLabel
                    let statusLabel: string
                    let statusClass: string
                    if (event.tool === 'web_search') {
                      if (event.stage === 'result') {
                        statusLabel = `${event.hits?.length ?? 0} 条结果`
                        statusClass = 'text-emerald-600'
                      } else if (event.stage === 'error') {
                        statusLabel = event.error || '搜索失败'
                        statusClass = 'text-destructive'
                      } else {
                        statusLabel = '检索中'
                        statusClass = 'text-amber-600'
                      }
                    } else {
                      if (event.stage === 'result') {
                        statusLabel = '完成'
                        statusClass = 'text-emerald-600'
                      } else if (event.stage === 'error') {
                        statusLabel = event.error || '失败'
                        statusClass = 'text-destructive'
                      } else {
                        statusLabel = '进行中'
                        statusClass = 'text-amber-600'
                      }
                    }
                    return (
                      <div key={event.id} className="reasoning-tools__item">
                        <div className="reasoning-tools__item-head">
                          <span>{primaryText}</span>
                          <span className={statusClass}>{statusLabel}</span>
                        </div>
                        {event.tool === 'web_search' && event.hits && event.hits.length > 0 && (
                          <ul className="reasoning-tools__hits">
                            {event.hits.slice(0, 3).map((hit, idx) => (
                              <li key={`${event.id}-${idx}`}>
                                <a href={hit.url} target="_blank" rel="noreferrer">
                                  {hit.title || hit.url}
                                </a>
                                {hit.snippet && <p>{hit.snippet}</p>}
                              </li>
                            ))}
                            {event.hits.length > 3 && <li className="text-muted-foreground">……</li>}
                          </ul>
                        )}
                        {event.error && <p className="reasoning-tools__error">{event.error}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {activePythonCall && (
        <Dialog open onOpenChange={(open) => { if (!open) setActivePythonCallId(null) }}>
          <DialogContent className="python-call-dialog" aria-describedby="python-call-detail">
            <DialogHeader>
              <DialogTitle>Python 调用详情</DialogTitle>
              <DialogDescription id="python-call-detail">
                {resolvePythonCallTitle(activePythonCall)}
              </DialogDescription>
            </DialogHeader>
            <PythonCallDetailBody call={activePythonCall} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

interface PythonCallDetailBodyProps {
  call: PythonToolCallItem
}

const PythonCallDetailBody = ({ call }: PythonCallDetailBodyProps) => {
  const duration =
    typeof call.details?.durationMs === 'number' ? call.details.durationMs : undefined
  const exitCode =
    typeof call.details?.exitCode === 'number' && Number.isFinite(call.details.exitCode)
      ? call.details.exitCode
      : '—'
  const code = call.details?.code ?? ''
  const stdout = call.details?.stdout ?? ''
  const stderr = call.details?.stderr ?? ''

  return (
    <div className="python-call-detail">
      <div className="python-call-detail__meta">
        <div>
          <span className="python-call-detail__meta-label">状态</span>
          <span className="python-call-detail__meta-value">{pythonStatusLabel[call.status]}</span>
        </div>
        <div>
          <span className="python-call-detail__meta-label">耗时</span>
          <span className="python-call-detail__meta-value">{formatDurationText(duration)}</span>
        </div>
        <div>
          <span className="python-call-detail__meta-label">退出码</span>
          <span className="python-call-detail__meta-value">{exitCode}</span>
        </div>
        <div>
          <span className="python-call-detail__meta-label">输出</span>
          <span className="python-call-detail__meta-value">
            {call.details?.truncated ? '已截断' : '完整'}
          </span>
        </div>
      </div>
      {call.resultSummary && !stdout && (
        <section className="python-call-detail__section">
          <h4>执行结果</h4>
          <pre>{call.resultSummary}</pre>
        </section>
      )}
      <section className="python-call-detail__section">
        <h4>Python 代码</h4>
        <pre>{code || '未返回 Python 代码'}</pre>
      </section>
      {stdout && (
        <section className="python-call-detail__section">
          <h4>运行输出</h4>
          <pre>{stdout}</pre>
          {call.details?.truncated && (
            <p className="python-call-detail__hint">输出经过截断，仅展示部分结果。</p>
          )}
        </section>
      )}
      {(stderr || call.error) && (
        <section className="python-call-detail__section">
          <h4>错误输出</h4>
          <pre>{stderr || call.error}</pre>
        </section>
      )}
    </div>
  )
}

export const ReasoningPanel = memo(ReasoningPanelComponent)
