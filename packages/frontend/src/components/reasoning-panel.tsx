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
  text: string
}

type ActivityItem =
  | {
      id: string
      kind: 'thought'
      text: string
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

const normalizeReasoningSource = (reasoningRaw: string) => reasoningRaw.replace(/\r/g, '').trim()

const resolveReasoningOffsetStart = (event: ToolEvent) => {
  const details = event.details
  if (!details || typeof details !== 'object') return null
  const candidate =
    typeof details.reasoningOffsetStart === 'number'
      ? details.reasoningOffsetStart
      : typeof details.reasoningOffset === 'number'
        ? details.reasoningOffset
        : null
  return candidate != null && Number.isFinite(candidate) && candidate >= 0 ? Math.floor(candidate) : null
}

const compareToolTimelineEvents = (a: ToolEvent, b: ToolEvent) => {
  const aOffset = resolveReasoningOffsetStart(a)
  const bOffset = resolveReasoningOffsetStart(b)
  if (aOffset != null && bOffset != null && aOffset !== bOffset) {
    return aOffset - bOffset
  }
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt
  }
  return a.id.localeCompare(b.id)
}

const cleanReasoningChunk = (chunk: string) =>
  chunk
    .split('\n')
    .map((line) => line.replace(/^>\s?/, ''))
    .join('\n')
    .trim()

const splitByBoundaries = (text: string, boundaries: number[]): string[] => {
  if (!text.trim()) return []
  const pickNaturalBoundary = (target: number) => {
    const maxOffset = Math.min(80, Math.floor(text.length / 3))
    const isBreakToken = (char: string) =>
      char === '\n' ||
      char === '。' ||
      char === '！' ||
      char === '？' ||
      char === '.' ||
      char === '!' ||
      char === '?' ||
      char === ';' ||
      char === '；'

    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const right = target + offset
      if (right > 0 && right < text.length && isBreakToken(text[right])) {
        return right + 1
      }
      const left = target - offset
      if (left > 1 && left < text.length && isBreakToken(text[left - 1])) {
        return left
      }
    }
    return target
  }

  const points = Array.from(
    new Set(boundaries.map((value) => pickNaturalBoundary(value)).filter((value) => value > 0 && value < text.length)),
  ).sort((a, b) => a - b)
  if (points.length === 0) return [text.trim()]

  const chunks: string[] = []
  let start = 0
  points.forEach((point) => {
    const chunk = text.slice(start, point).trim()
    if (chunk) chunks.push(chunk)
    start = point
  })
  const tail = text.slice(start).trim()
  if (tail) chunks.push(tail)
  return chunks
}

const collectToolBoundaryMarkers = (events: ToolEvent[]): string[] => {
  const markers: string[] = []
  const seen = new Set<string>()
  const sorted = events.slice().sort(compareToolTimelineEvents)

  sorted.forEach((event) => {
    const candidates: string[] = []
    if (typeof event.query === 'string') candidates.push(event.query)
    if (typeof event.summary === 'string') candidates.push(event.summary)
    if (event.details && typeof event.details === 'object') {
      const url = event.details.url
      const title = event.details.title
      const input = event.details.input
      if (typeof url === 'string') candidates.push(url)
      if (typeof title === 'string') candidates.push(title)
      if (typeof input === 'string') candidates.push(input)
    }

    candidates.forEach((candidate) => {
      const normalized = candidate.replace(/\s+/g, ' ').trim()
      if (normalized.length < 4) return
      const token = normalized.length > 48 ? normalized.slice(0, 48) : normalized
      const lowered = token.toLowerCase()
      if (seen.has(lowered)) return
      seen.add(lowered)
      markers.push(token)
    })
  })

  return markers
}

const collectBoundariesByReasoningOffsets = (events: ToolEvent[], textLength: number): number[] => {
  if (textLength <= 1 || events.length === 0) return []
  const boundaries: number[] = []
  let cursor = 0

  events.forEach((event) => {
    const details = event.details
    if (!details || typeof details !== 'object') return
    const candidate =
      typeof details.reasoningOffsetStart === 'number'
        ? details.reasoningOffsetStart
        : typeof details.reasoningOffset === 'number'
          ? details.reasoningOffset
          : null
    if (candidate == null || !Number.isFinite(candidate)) return
    const point = Math.floor(candidate)
    if (point <= 0 || point >= textLength) return
    if (point <= cursor) return
    boundaries.push(point)
    cursor = point
  })

  return boundaries
}

const findBoundariesByMarkers = (
  text: string,
  markers: string[],
  maxBoundaries: number,
): number[] => {
  if (markers.length === 0 || maxBoundaries <= 0) return []
  const boundaries: number[] = []
  let cursor = 0
  const minGap = 36

  for (const marker of markers) {
    if (boundaries.length >= maxBoundaries) break
    const index = text.indexOf(marker, cursor)
    if (index < 0) continue
    if (index - cursor < minGap) {
      cursor = index + marker.length
      continue
    }
    boundaries.push(index)
    cursor = index + marker.length
  }
  return boundaries
}

const buildEvenBoundaries = (textLength: number, segmentCount: number): number[] => {
  if (segmentCount <= 1 || textLength <= 1) return []
  const boundaries = new Set<number>()
  for (let i = 1; i < segmentCount; i += 1) {
    const point = Math.floor((textLength * i) / segmentCount)
    if (point > 0 && point < textLength) boundaries.add(point)
  }
  return Array.from(boundaries).sort((a, b) => a - b)
}

const buildThoughtSegments = (
  reasoningRaw: string,
  toolTimeline: ToolEvent[],
): ThoughtSegment[] => {
  const source = normalizeReasoningSource(reasoningRaw)
  if (!source) return []

  const sortedTools = toolTimeline.slice().sort(compareToolTimelineEvents)
  const expectedSegments = Math.max(1, sortedTools.length + 1)
  let boundaries: number[] = []

  if (sortedTools.length > 0) {
    boundaries = collectBoundariesByReasoningOffsets(sortedTools, source.length)

    // 历史消息可能没有 offset，回退到 marker/均匀切分兜底
    if (boundaries.length !== expectedSegments - 1) {
      const markers = collectToolBoundaryMarkers(sortedTools)
      boundaries = findBoundariesByMarkers(source, markers, expectedSegments - 1)
    }

    if (boundaries.length !== expectedSegments - 1) {
      boundaries = buildEvenBoundaries(source.length, expectedSegments)
    }
  }

  const chunks = splitByBoundaries(source, boundaries)
  const segments = chunks
    .map((chunk) => cleanReasoningChunk(chunk))
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => ({ text: chunk }))
  if (segments.length > 0) return segments
  return [{ text: cleanReasoningChunk(source) }]
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
  reasoningUnavailableCode?: string | null
  reasoningUnavailableReason?: string | null
  reasoningUnavailableSuggestion?: string | null
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
  reasoningUnavailableCode,
  reasoningUnavailableReason,
  reasoningUnavailableSuggestion,
  toolSummary,
  toolTimeline,
}: ReasoningPanelProps) {
  const [activePythonCallId, setActivePythonCallId] = useState<string | null>(null)
  const [rawReasoningOpen, setRawReasoningOpen] = useState(false)

  const pythonCalls = useMemo(
    () => (expanded ? aggregatePythonCalls(toolTimeline) : []),
    [expanded, toolTimeline],
  )
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
    () => (expanded ? buildThoughtSegments(reasoningRaw, toolTimeline) : []),
    [expanded, reasoningRaw, toolTimeline],
  )
  const hasReasoning = reasoningRaw.trim().length > 0 || Boolean(reasoningHtml)
  const hasUnavailableReasoning =
    typeof reasoningUnavailableReason === 'string' && reasoningUnavailableReason.trim().length > 0

  const activityItems = useMemo(() => {
    if (!expanded) return [] as ActivityItem[]
    const items: ActivityItem[] = []
    const sortedTools = toolTimeline.slice().sort(compareToolTimelineEvents)

    if (sortedTools.length === 0) {
      thoughtSegments.forEach((segment, index) => {
        items.push({
          id: `thought-only-${index}`,
          kind: 'thought',
          text: segment.text,
        })
      })
    } else {
      sortedTools.forEach((event, index) => {
        const thought = thoughtSegments[index]
        if (thought) {
          items.push({
            id: `thought-${index}`,
            kind: 'thought',
            text: thought.text,
          })
        }

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

      if (thoughtSegments.length > sortedTools.length) {
        thoughtSegments.slice(sortedTools.length).forEach((segment, index) => {
          items.push({
            id: `thought-tail-${index}`,
            kind: 'thought',
            text: segment.text,
          })
        })
      }
    }

    if (items.length === 0) {
      if (status === 'idle') {
        items.push({
          id: 'thought-idle',
          kind: 'thought',
          text:
            typeof idleMs === 'number' && idleMs > 0
              ? `正在思考当前问题（已静默 ${Math.round(idleMs / 1000)} 秒）`
              : '正在思考当前问题',
        })
      } else if (status === 'streaming') {
        items.push({
          id: 'thought-streaming',
          kind: 'thought',
          text: '正在整理输出结果，稍后将展示完整活动轨迹。',
        })
      } else if (hasUnavailableReasoning) {
        const reasonText =
          typeof reasoningUnavailableReason === 'string' ? reasoningUnavailableReason.trim() : ''
        const suggestionText =
          typeof reasoningUnavailableSuggestion === 'string' && reasoningUnavailableSuggestion.trim()
            ? ` ${reasoningUnavailableSuggestion.trim()}`
            : ''
        const codeText =
          typeof reasoningUnavailableCode === 'string' && reasoningUnavailableCode.trim()
            ? `（${reasoningUnavailableCode.trim()}）`
            : ''
        items.push({
          id: 'thought-unavailable',
          kind: 'thought',
          text: `${reasonText}${codeText}${suggestionText}`.trim(),
        })
      }
    }

    return items
  }, [
    expanded,
    hasUnavailableReasoning,
    idleMs,
    pythonCallMap,
    reasoningUnavailableCode,
    reasoningUnavailableReason,
    reasoningUnavailableSuggestion,
    status,
    thoughtSegments,
    toolTimeline,
  ])

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
    if (!hasReasoning && hasUnavailableReasoning) {
      return reasoningUnavailableReason?.trim() || '模型未返回可展示推理内容'
    }
    if (hasReasoning) return '查看思考与工具调用轨迹'
    return '暂无活动详情'
  }, [displayStatus, hasReasoning, hasUnavailableReasoning, reasoningUnavailableReason, toolSummary?.summaryText])

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
                      <p className="reasoning-activity-item__description">{item.text}</p>
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
