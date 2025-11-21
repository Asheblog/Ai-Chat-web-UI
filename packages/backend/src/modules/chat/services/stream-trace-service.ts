import { analyzeLatexBlocks as defaultAnalyze } from '@aichat/shared/latex-normalizer'
import { LatexTraceRecorder as DefaultLatexTraceRecorder } from '../../../utils/latex-trace'
import type { TaskTraceRecorder } from '../../../utils/task-trace'
import { BackendLogger as log } from '../../../utils/logger'

export interface TraceMetadataExtras {
  providerUsageSource?: 'provider' | 'fallback'
  finalUsage?: any
  reasoningDurationSeconds?: number
}

export interface HandleLatexParams {
  traceRecorder: TaskTraceRecorder
  latexTraceRecorder: InstanceType<typeof DefaultLatexTraceRecorder> | null
  content: string
  assistantMessageId: number | null
  assistantClientMessageId?: string | null
  clientMessageId?: string | null
}

export interface HandleLatexResult {
  latexTraceRecorder: InstanceType<typeof DefaultLatexTraceRecorder> | null
  latexAuditSummary: { matched: number; unmatched: number } | null
}

export interface StreamTraceServiceDeps {
  analyzeLatexBlocks?: typeof defaultAnalyze
  LatexTraceRecorder?: typeof DefaultLatexTraceRecorder
  logger?: Pick<typeof console, 'warn'>
}

export class StreamTraceService {
  private analyzeLatexBlocks: typeof defaultAnalyze
  private LatexTraceRecorder: typeof DefaultLatexTraceRecorder
  private logger: Pick<typeof console, 'warn'>

  constructor(deps: StreamTraceServiceDeps = {}) {
    this.analyzeLatexBlocks = deps.analyzeLatexBlocks ?? defaultAnalyze
    this.LatexTraceRecorder = deps.LatexTraceRecorder ?? DefaultLatexTraceRecorder
    this.logger = deps.logger ?? log
  }

  async handleLatexTrace(params: HandleLatexParams): Promise<HandleLatexResult> {
    let latexTraceRecorder = params.latexTraceRecorder
    let latexAuditSummary: { matched: number; unmatched: number } | null = null

    const traceId = params.traceRecorder.getTraceId()
    if (!params.traceRecorder.isEnabled() || !traceId) {
      return { latexTraceRecorder, latexAuditSummary }
    }

    const trimmed = params.content.trim()
    if (!trimmed) {
      return { latexTraceRecorder, latexAuditSummary }
    }

    try {
      const audit = this.analyzeLatexBlocks(trimmed)
      if (audit.segments.length > 0) {
        latexAuditSummary = { matched: audit.matchedCount, unmatched: audit.unmatchedCount }
        latexTraceRecorder = await this.LatexTraceRecorder.create({
          taskTraceId: traceId,
          matchedBlocks: audit.matchedCount,
          unmatchedBlocks: audit.unmatchedCount,
          metadata: {
            segmentsSample: audit.segments.slice(0, 3).map((segment) => ({
              matched: segment.matched,
              reason: segment.reason,
              preview: segment.trimmed.slice(0, 80),
            })),
          },
        })
        latexTraceRecorder?.logSegments(audit.segments)
      }
    } catch (error) {
      this.logger.warn?.('Latex trace creation failed', error)
    }

    if (params.assistantMessageId) {
      params.traceRecorder.setMessageContext(
        params.assistantMessageId,
        params.assistantClientMessageId ?? params.clientMessageId,
      )
    }

    return { latexTraceRecorder, latexAuditSummary }
  }
}

let streamTraceService = new StreamTraceService()

export const setStreamTraceService = (service: StreamTraceService) => {
  streamTraceService = service
}

export { streamTraceService }
