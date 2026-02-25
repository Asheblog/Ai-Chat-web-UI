'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { Brain, ChevronDown, Globe, Loader2, Sigma } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToolEvent, ToolEventDetails } from '@/types'
import { TypewriterReasoning } from './typewriter-reasoning'

const formatToolName = (tool: string | undefined) => {
  if (!tool) return '工具'
  if (tool === 'web_search') return '联网搜索'
  if (tool === 'python_runner') return 'Python 工具'
  if (tool === 'read_url') return '网页读取'
  if (tool === 'document_search') return '文档搜索'
  if (tool === 'document_list') return '文档列表'
  if (tool === 'kb_search') return '知识库搜索'
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

interface ActivityDomain {
  label: string
  url?: string
}

interface ThoughtSegment {
  title: string
  description?: string
}

const PLANNING_KEYWORDS = ['目标', '计划', '先', '首先', '为了', '需要', 'i need', 'plan', 'goal']
const EXECUTION_KEYWORDS = ['搜索', '检索', '读取', '调用', '工具', '联网', 'search', 'query', 'tool', 'read']
const FINDING_KEYWORDS = ['了解到', '发现', '结果', '关键信息', '要点', '数据', '证据', 'found', 'key']
const SYNTHESIS_KEYWORDS = ['总结', '综合', '整理', '结论', '最终', '回答', 'synth', 'final', 'answer']

type ActivityItem =
  | {
      id: string
      kind: 'thought'
      title: string
      description?: string
    }
  | {
      id: string
      kind: 'tool'
      tool: string
      status: ToolEvent['status']
      title: string
      description?: string
      domains: ActivityDomain[]
      canOpenPythonDetail: boolean
      pythonCallId?: string
    }

const pythonStatusLabel: Record<ToolEvent['status'], string> = {
  success: '完成',
  running: '进行中',
  error: '失败',
}

const normalizeToolStatus = (
  event: Pick<ToolEvent, 'status' | 'stage'>,
): ToolEvent['status'] => {
  if (event.status === 'success' || event.status === 'running' || event.status === 'error') {
    return event.status
  }
  if (event.stage === 'result') return 'success'
  if (event.stage === 'error') return 'error'
  return 'running'
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
        status: normalizeToolStatus(event),
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
  return '运行 Python 代码'
}

const resolvePythonCallSubtitle = (call: PythonToolCallItem) => {
  if (call.status === 'error') {
    return clampText(call.error ?? '执行失败', 100)
  }
  if (call.status === 'success') {
    const primary = call.resultSummary ?? extractFirstMeaningfulLine(call.details?.stdout)
    return primary ? clampText(primary, 100) : '执行完成，点击查看输出'
  }
  return '正在执行代码'
}

const formatDurationText = (durationMs?: number) => {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) return '—'
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(2)}s`
}

const normalizeUrl = (input: string): string | null => {
  const raw = input.trim()
  if (!raw) return null
  try {
    return new URL(raw).toString()
  } catch {
    try {
      return new URL(`https://${raw}`).toString()
    } catch {
      return null
    }
  }
}

const extractDomain = (input?: string | null): string | null => {
  if (!input) return null
  const normalized = normalizeUrl(input)
  if (!normalized) return null
  try {
    return new URL(normalized).hostname.replace(/^www\./i, '')
  } catch {
    return null
  }
}

const normalizeReasoningText = (reasoningRaw: string) =>
  reasoningRaw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim()

const splitReasoningSentences = (normalized: string): string[] =>
  normalized
    .split('\n')
    .flatMap((line) => line.split(/(?<=[。！？.!?])\s+/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)

const containsAnyKeyword = (sentence: string, keywords: string[]) => {
  const lowered = sentence.toLowerCase()
  return keywords.some((keyword) => lowered.includes(keyword))
}

const pickSentencesByKeywords = (sentences: string[], keywords: string[], limit = 2): string[] => {
  const picked: string[] = []
  for (const sentence of sentences) {
    if (!containsAnyKeyword(sentence, keywords)) continue
    if (picked.some((item) => item === sentence)) continue
    picked.push(clampText(sentence, 120))
    if (picked.length >= limit) break
  }
  return picked
}

const createThoughtSegment = (title: string, source: string[]): ThoughtSegment => {
  const cleanedTitle = clampText(title.replace(/[：:]\s*$/, '').trim(), 64)
  const merged = source
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .join(' ')
  return {
    title: cleanedTitle,
    description: merged.length > 0 ? clampText(merged, 240) : undefined,
  }
}

const extractHeadingSegment = (normalized: string): ThoughtSegment | null => {
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const headingLine = lines.find((line) => /[:：]$/.test(line) && line.length >= 8 && line.length <= 48)
  if (!headingLine) return null
  const heading = headingLine.replace(/[:：]\s*$/, '').trim()
  const following = lines
    .slice(lines.indexOf(headingLine) + 1)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return createThoughtSegment(heading, following ? [following] : [])
}

const buildThoughtSegments = (
  reasoningRaw: string,
  toolTimeline: ToolEvent[],
  maxSegments = 4,
): ThoughtSegment[] => {
  const normalized = normalizeReasoningText(reasoningRaw)
  if (!normalized) return []

  const sentences = splitReasoningSentences(normalized)
  if (sentences.length === 0) return []

  const planning = pickSentencesByKeywords(sentences, PLANNING_KEYWORDS, 2)
  const execution = pickSentencesByKeywords(sentences, EXECUTION_KEYWORDS, 2)
  const findings = pickSentencesByKeywords(sentences, FINDING_KEYWORDS, 2)
  const synthesis = pickSentencesByKeywords(sentences, SYNTHESIS_KEYWORDS, 1)
  const headingSegment = extractHeadingSegment(normalized)

  const segments: ThoughtSegment[] = []

  if (planning.length > 0) {
    segments.push(createThoughtSegment('明确目标与策略', planning))
  }

  if (execution.length > 0 || toolTimeline.length > 0) {
    const webSearchCount = toolTimeline.filter((event) => event.tool === 'web_search').length
    const title =
      webSearchCount > 1
        ? '并行检索多个来源'
        : webSearchCount === 1
          ? '检索关键来源'
          : toolTimeline.length > 0
            ? '调用工具收集信息'
            : '执行信息收集'
    const fallback = toolTimeline.length > 0 ? [`已触发 ${toolTimeline.length} 次工具调用，持续收集证据。`] : []
    segments.push(createThoughtSegment(title, execution.length > 0 ? execution : fallback))
  }

  if (headingSegment) {
    segments.push(headingSegment)
  } else if (findings.length > 0) {
    segments.push(createThoughtSegment('提炼关键发现', findings))
  }

  if (synthesis.length > 0) {
    segments.push(createThoughtSegment('组织最终回答', synthesis))
  }

  if (segments.length === 0) {
    segments.push(createThoughtSegment('整理思考过程', [sentences.slice(0, 3).join(' ')]))
  }

  return segments.slice(0, maxSegments)
}

const uniqueDomains = (domains: ActivityDomain[]) => {
  const seen = new Set<string>()
  const deduped: ActivityDomain[] = []
  for (const domain of domains) {
    const key = domain.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(domain)
  }
  return deduped
}

const resolveDomainsForEvent = (event: ToolEvent): ActivityDomain[] => {
  if (event.tool === 'web_search') {
    if (!Array.isArray(event.hits)) return []
    const entries: ActivityDomain[] = []
    event.hits.forEach((hit) => {
      const label = extractDomain(hit.url)
      if (!label) return
      const url = typeof hit.url === 'string' ? normalizeUrl(hit.url) : null
      if (url) {
        entries.push({ label, url })
      } else {
        entries.push({ label })
      }
    })
    return uniqueDomains(entries)
  }

  const detailUrl =
    event.details && typeof event.details.url === 'string'
      ? event.details.url
      : typeof event.query === 'string' && event.query.includes('.')
        ? event.query
        : null

  const label = extractDomain(detailUrl)
  if (!label) return []
  return [{ label, url: normalizeUrl(detailUrl ?? '') ?? undefined }]
}

const resolveToolTitle = (event: ToolEvent, pythonCall?: PythonToolCallItem) => {
  if (event.tool === 'web_search') {
    const query = event.query?.trim()
    return query ? `Searching for ${query}` : 'Searching the web'
  }

  if (event.tool === 'read_url') {
    const detailTitle =
      event.details && typeof event.details.title === 'string' ? event.details.title.trim() : ''
    if (detailTitle) return `Reading ${clampText(detailTitle, 80)}`
    const query = event.query?.trim()
    if (query) return `Reading ${clampText(query, 80)}`
    return 'Reading web content'
  }

  if (event.tool === 'python_runner' && pythonCall) {
    return resolvePythonCallTitle(pythonCall)
  }

  if (event.summary && event.summary.trim()) {
    return clampText(event.summary.trim(), 96)
  }
  if (event.query && event.query.trim()) {
    return clampText(event.query.trim(), 96)
  }
  return `${formatToolName(event.tool)} 调用`
}

const resolveToolDescription = (event: ToolEvent, pythonCall?: PythonToolCallItem) => {
  if (event.tool === 'python_runner' && pythonCall) {
    return resolvePythonCallSubtitle(pythonCall)
  }

  if (event.stage === 'error') {
    return event.error || '工具调用失败'
  }

  if (event.tool === 'web_search' && event.stage === 'result') {
    const hitCount = Array.isArray(event.hits) ? event.hits.length : 0
    if (event.summary?.trim()) return event.summary.trim()
    return `已获取 ${hitCount} 条候选结果`
  }

  if (event.tool === 'read_url') {
    const excerpt =
      event.details && typeof event.details.excerpt === 'string' ? event.details.excerpt.trim() : ''
    if (excerpt) return clampText(excerpt, 180)
    if (event.summary?.trim()) return event.summary.trim()
    return event.stage === 'result' ? '网页读取完成' : '正在读取网页正文'
  }

  if (event.summary?.trim()) return event.summary.trim()
  if (event.stage === 'result') return '工具调用完成'
  return '正在执行工具调用'
}

const toActivityDuration = (seconds?: number | null) => {
  if (typeof seconds !== 'number' || seconds <= 0 || Number.isNaN(seconds)) return null
  const total = Math.max(1, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
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
  idle: '思考中',
  streaming: '处理中',
  done: '已完成',
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
  const [activePythonCallId, setActivePythonCallId] = useState<string | null>(null)
  const [rawReasoningOpen, setRawReasoningOpen] = useState(false)

  const pythonCalls = useMemo(() => aggregatePythonCalls(toolTimeline), [toolTimeline])
  const pythonCallMap = useMemo(() => {
    const map = new Map<string, PythonToolCallItem>()
    pythonCalls.forEach((call) => map.set(call.id, call))
    return map
  }, [pythonCalls])

  const activePythonCall = useMemo(() => {
    if (!activePythonCallId) return null
    return pythonCallMap.get(activePythonCallId) ?? null
  }, [activePythonCallId, pythonCallMap])

  useEffect(() => {
    if (!activePythonCallId) return
    if (!pythonCallMap.has(activePythonCallId)) {
      setActivePythonCallId(null)
    }
  }, [activePythonCallId, pythonCallMap])

  const thoughtSegments = useMemo(
    () => buildThoughtSegments(reasoningRaw, toolTimeline),
    [reasoningRaw, toolTimeline],
  )

  const activityItems = useMemo(() => {
    const items: ActivityItem[] = []

    if (thoughtSegments.length > 0) {
      items.push({
        id: 'thought-0',
        kind: 'thought',
        title: thoughtSegments[0].title,
        description: thoughtSegments[0].description,
      })
    }

    toolTimeline.forEach((event) => {
      const pythonCall = event.tool === 'python_runner' ? pythonCallMap.get(event.id) : undefined
      const item: ActivityItem = {
        id: `tool-${event.id}`,
        kind: 'tool',
        tool: event.tool,
        status: normalizeToolStatus(event),
        title: resolveToolTitle(event, pythonCall),
        description: resolveToolDescription(event, pythonCall),
        domains: resolveDomainsForEvent(event),
        canOpenPythonDetail: Boolean(
          event.tool === 'python_runner' &&
            pythonCall &&
            (pythonCall.status === 'success' || pythonCall.status === 'error'),
        ),
        pythonCallId: pythonCall?.id,
      }
      items.push(item)
    })

    if (thoughtSegments.length > 1) {
      thoughtSegments.slice(1).forEach((segment, index) => {
        items.push({
          id: `thought-tail-${index}`,
          kind: 'thought',
          title: segment.title,
          description: segment.description,
        })
      })
    }

    if (items.length === 0) {
      if (status === 'idle') {
        items.push({
          id: 'thought-idle',
          kind: 'thought',
          title: '正在思考当前问题',
          description:
            typeof idleMs === 'number' && idleMs > 0
              ? `已静默 ${Math.round(idleMs / 1000)} 秒，模型仍在处理。`
              : '模型正在组织答案。',
        })
      } else if (status === 'streaming') {
        items.push({
          id: 'thought-streaming',
          kind: 'thought',
          title: '正在整理输出结果',
          description: '稍后将展示完整活动轨迹。',
        })
      }
    }

    return items
  }, [idleMs, pythonCallMap, status, thoughtSegments, toolTimeline])

  const hasReasoning = reasoningRaw.trim().length > 0 || Boolean(reasoningHtml)

  // 当 reasoningStatus 已完成但打字机尚未播放完时，保持“处理中”状态
  const typewriterStillPlaying = useMemo(() => {
    if (status !== 'done') return false
    if (!hasReasoning) return false
    const totalLength = reasoningRaw.length
    const playedLength = typeof reasoningPlayedLength === 'number' ? reasoningPlayedLength : totalLength
    return playedLength < totalLength
  }, [status, hasReasoning, reasoningRaw.length, reasoningPlayedLength])

  const displayStatus = typewriterStillPlaying ? 'streaming' : status
  const headerStatusText = displayStatus ? statusTextMap[displayStatus] : '查看活动'

  const computedDuration = useMemo(() => {
    const fromMeta = toActivityDuration(durationSeconds)
    if (fromMeta) return fromMeta
    if (toolTimeline.length > 1) {
      const first = toolTimeline[0]?.createdAt ?? 0
      const last = toolTimeline[toolTimeline.length - 1]?.createdAt ?? first
      const spanSeconds = Math.round(Math.max(0, last - first) / 1000)
      const fromTimeline = toActivityDuration(spanSeconds)
      if (fromTimeline) return fromTimeline
    }
    if (displayStatus === 'streaming' || displayStatus === 'idle') {
      return '进行中'
    }
    return '0s'
  }, [displayStatus, durationSeconds, toolTimeline])

  const headerSubtitle = useMemo(() => {
    if (toolSummary?.summaryText) return toolSummary.summaryText
    if (displayStatus === 'idle') return '模型正在思考'
    if (displayStatus === 'streaming') return '模型正在处理'
    if (hasReasoning) return '查看思考与工具调用轨迹'
    return '暂无活动详情'
  }, [displayStatus, hasReasoning, toolSummary?.summaryText])

  return (
    <div className={`reasoning-panel${expanded ? ' reasoning-panel--expanded' : ''}`}>
      <button
        type="button"
        className="reasoning-header"
        onClick={onToggle}
        aria-expanded={expanded}
        title="活动（可折叠）"
      >
        <span className="reasoning-header__left">
          <span className={`reasoning-status-icon ${displayStatus ?? 'none'}`}>
            {displayStatus === 'streaming' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
          </span>
          <span>
            <span className="reasoning-header__title">活动 · {computedDuration}</span>
            <span className="reasoning-header__subtitle">{headerStatusText} · {headerSubtitle}</span>
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="reasoning-activity">
          <div className="reasoning-activity__section">思考</div>

          <div className="reasoning-activity__timeline" role="list">
            {activityItems.map((item) => {
              if (item.kind === 'thought') {
                return (
                  <div key={item.id} role="listitem" className="reasoning-activity-item">
                    <div className="reasoning-activity-item__dot" aria-hidden="true" />
                    <div className="reasoning-activity-item__body">
                      <p className="reasoning-activity-item__title">{item.title}</p>
                      {item.description && (
                        <p className="reasoning-activity-item__description">{item.description}</p>
                      )}
                    </div>
                  </div>
                )
              }

              const visibleDomains = item.domains.slice(0, 3)
              const extraDomains = item.domains.length - visibleDomains.length

              return (
                <div key={item.id} role="listitem" className="reasoning-activity-item reasoning-activity-item--tool">
                  <div className="reasoning-activity-item__dot reasoning-activity-item__dot--tool" aria-hidden="true">
                    {item.tool === 'python_runner' ? <Sigma className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
                  </div>
                  <div className="reasoning-activity-item__body">
                    <div className="reasoning-activity-item__headline">
                      <p className="reasoning-activity-item__title">{item.title}</p>
                      <span
                        className={`reasoning-activity-item__status reasoning-activity-item__status--${item.status}`}
                      >
                        {pythonStatusLabel[item.status]}
                      </span>
                    </div>
                    {item.description && (
                      <p className="reasoning-activity-item__description">{item.description}</p>
                    )}

                    {visibleDomains.length > 0 && (
                      <div className="reasoning-activity-item__domains">
                        {visibleDomains.map((domain) =>
                          domain.url ? (
                            <a
                              key={`${item.id}-${domain.label}`}
                              className="reasoning-domain-chip"
                              href={domain.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {domain.label}
                            </a>
                          ) : (
                            <span key={`${item.id}-${domain.label}`} className="reasoning-domain-chip">
                              {domain.label}
                            </span>
                          )
                        )}
                        {extraDomains > 0 && (
                          <span className="reasoning-domain-chip reasoning-domain-chip--muted">
                            再显示 {extraDomains} 个
                          </span>
                        )}
                      </div>
                    )}

                    {item.canOpenPythonDetail && item.pythonCallId && (
                      <button
                        type="button"
                        className="reasoning-activity-item__action"
                        onClick={() => setActivePythonCallId(item.pythonCallId ?? null)}
                      >
                        查看代码与输出
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {hasReasoning && (
            <div className="reasoning-raw">
              <button
                type="button"
                className="reasoning-raw__toggle"
                onClick={() => setRawReasoningOpen((prev) => !prev)}
                aria-expanded={rawReasoningOpen}
              >
                {rawReasoningOpen ? '收起原始思考' : '查看原始思考'}
              </button>
              {rawReasoningOpen && (
                <div className="reasoning-raw__content">
                  {!isStreaming && reasoningHtml ? (
                    <div
                      className="markdown-body markdown-body--reasoning"
                      dangerouslySetInnerHTML={{ __html: reasoningHtml }}
                    />
                  ) : (
                    <TypewriterReasoning
                      text={reasoningRaw}
                      isStreaming={isStreaming}
                      initialPlayedLength={reasoningPlayedLength}
                      speed={20}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activePythonCall && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setActivePythonCallId(null)
          }}
        >
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
  const duration = typeof call.details?.durationMs === 'number' ? call.details.durationMs : undefined
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
