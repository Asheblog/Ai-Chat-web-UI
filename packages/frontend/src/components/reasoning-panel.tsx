'use client'

import { memo, useMemo, useState } from 'react'
import { Brain, ChevronDown, Loader2 } from 'lucide-react'
import { ToolEvent } from '@/types'
import { TypewriterReasoning } from './typewriter-reasoning'

interface ReasoningPanelProps {
  status?: 'idle' | 'streaming' | 'done'
  durationSeconds?: number | null
  idleMs?: number | null
  expanded: boolean
  onToggle: () => void
  reasoningRaw: string
  reasoningHtml?: string
  isStreaming: boolean
  toolSummary: { total: number; summaryText: string } | null
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
  isStreaming,
  toolSummary,
  toolTimeline,
}: ReasoningPanelProps) {
  const [toolTimelineOpen, setToolTimelineOpen] = useState(false)

  const hasReasoning = reasoningRaw.trim().length > 0 || Boolean(reasoningHtml)
  const placeholderText =
    status === 'streaming'
      ? '推理内容接收中…'
      : status === 'idle'
        ? '正在思考中…'
        : '暂无推理内容'

  const statusLabel = status ? statusTextMap[status] : '思维过程'
  const durationLabel =
    typeof durationSeconds === 'number' && durationSeconds > 0
      ? `用时 ${durationSeconds}s`
      : null
  const idleLabel =
    status === 'idle' && typeof idleMs === 'number' && idleMs > 0
      ? `静默 ${Math.round(idleMs / 1000)}s`
      : null

  const headerSubtitle = useMemo(() => {
    if (durationLabel) return durationLabel
    if (idleLabel) return idleLabel
    if (status === 'streaming') return '正在整理答案'
    if (status === 'idle') return '准备推理中'
    return '查看模型推理轨迹'
  }, [durationLabel, idleLabel, status])

  return (
    <div className="reasoning-panel">
      <button
        type="button"
        className="reasoning-header"
        onClick={onToggle}
        aria-expanded={expanded}
        title="思维链（可折叠）"
      >
        <span className="reasoning-header__left">
          <span className={`reasoning-status-icon ${status ?? 'idle'}`}>
            {status === 'streaming' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
          </span>
          <span>
            <span className="reasoning-header__title">{statusLabel}</span>
            <span className="reasoning-header__subtitle">{headerSubtitle}</span>
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="reasoning-body">
          {status === 'idle' && (
            <div className="reasoning-hint">
              模型正在思考…
              {idleLabel ? `（${idleLabel}）` : null}
            </div>
          )}

          <div className="reasoning-timeline">
            {hasReasoning ? (
              reasoningHtml ? (
                <div
                  className="markdown-body markdown-body--reasoning reasoning-markdown"
                  dangerouslySetInnerHTML={{ __html: reasoningHtml }}
                />
              ) : (
                <div className="reasoning-item reasoning-markdown--typewriter">
                  <TypewriterReasoning text={reasoningRaw} isStreaming={isStreaming} speed={20} />
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
                  <div className="reasoning-tools__title">联网搜索 · {toolSummary.total} 次</div>
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
                  {toolTimeline.map((event) => {
                    const statusLabel =
                      event.stage === 'start'
                        ? '检索中'
                        : event.stage === 'result'
                          ? `${event.hits?.length ?? 0} 条结果`
                          : event.error || '搜索失败'
                    const statusClass =
                      event.stage === 'start'
                        ? 'text-amber-600'
                        : event.stage === 'result'
                          ? 'text-emerald-600'
                          : 'text-destructive'
                    return (
                      <div key={event.id} className="reasoning-tools__item">
                        <div className="reasoning-tools__item-head">
                          <span>{event.query || '未提供查询'}</span>
                          <span className={statusClass}>{statusLabel}</span>
                        </div>
                        {event.hits && event.hits.length > 0 && (
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
        </div>
      )}
    </div>
  )
}

export const ReasoningPanel = memo(ReasoningPanelComponent)
