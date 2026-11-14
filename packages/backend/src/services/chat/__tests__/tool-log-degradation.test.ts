import { buildToolOperationIndex, buildToolOperationSummary } from '@aichat/shared/tool-operations'
import { serializeToolLogsForPersistence } from '../tool-log-persistence'
import { parseToolLogsPayloadJson } from '../tool-log-parse'
import { buildShareToolEvents } from '../../shares/share-tool-events'
import type { ToolLogEntry } from '../tool-log-model'

/**
 * 运行时证实：存储层自己的裁剪（>500 字段、512KB 压缩）若写 details.truncated，
 * shared 会把它读成执行降级 → live 成功刷新后变降级。
 * 存储裁剪只允许写 details.storageTruncated；运行时真的 truncated 必须保留。
 */
const liveSuccess = (overrides: Partial<ToolLogEntry> = {}): ToolLogEntry => ({
  id: 'call_1',
  callId: 'call_1',
  tool: 'python_runner',
  stage: 'result',
  status: 'success',
  createdAt: 1000,
  details: { stdout: 'x'.repeat(2000), exitCode: 0 },
  ...overrides,
})

const summarize = (events: unknown[]) =>
  buildToolOperationSummary(buildToolOperationIndex(events as never))

describe('存储裁剪不伪装成执行降级', () => {
  test('live 成功 + 长字段被裁：历史列表仍是成功且未降级', () => {
    const json = serializeToolLogsForPersistence([liveSuccess()])
    const history = parseToolLogsPayloadJson(json, { mode: 'history-list' })
    const entry = history.entries[0]

    expect(entry.status).toBe('success')
    expect(entry.details?.storageTruncated).toBe(true)
    expect(entry.details?.truncated).toBeUndefined()

    const summary = summarize(history.entries)
    expect(summary.degraded).toBe(0)
    expect(summary.succeeded).toBe(1)
    expect(summary.failedOperations).toBe(0)
  })

  test('详情路径与分享快照同样不被判降级', () => {
    const json = serializeToolLogsForPersistence([liveSuccess()])
    const detail = parseToolLogsPayloadJson(json)
    expect(summarize(detail.entries).degraded).toBe(0)

    const shareEvents = buildShareToolEvents(detail.entries)
    expect(shareEvents[0].details?.storageTruncated).toBe(true)
    expect(summarize(shareEvents).degraded).toBe(0)
    expect(summarize(shareEvents).succeeded).toBe(1)
  })

  test('运行时真的 truncated 保留下来，仍然算降级', () => {
    const json = serializeToolLogsForPersistence([
      liveSuccess({ details: { stdout: 'y'.repeat(2000), truncated: true } }),
    ])
    const history = parseToolLogsPayloadJson(json, { mode: 'history-list' })
    const entry = history.entries[0]

    expect(entry.details?.truncated).toBe(true)
    expect(entry.details?.storageTruncated).toBe(true)
    expect(summarize(history.entries).degraded).toBe(1)
    expect(summarize(history.entries).succeeded).toBe(1)
  })

  test('运行时 truncated 不因存储不裁剪而被清除', () => {
    const json = serializeToolLogsForPersistence([
      liveSuccess({ details: { stdout: 'short', truncated: true } }),
    ])
    const entry = parseToolLogsPayloadJson(json).entries[0]
    expect(entry.details?.truncated).toBe(true)
    expect(entry.details?.storageTruncated).toBeUndefined()
  })

  test('512KB 压缩层同样只写 storageTruncated，成功记录不变降级', () => {
    const logs = Array.from({ length: 40 }, (_, i) =>
      liveSuccess({
        id: `call_${i}`,
        callId: `call_${i}`,
        createdAt: 1000 + i,
        summary: 's'.repeat(400),
        hits: [{ title: `t${i}`, url: `https://example.com/${i}`, snippet: 'n'.repeat(300) }],
        details: { stdout: 'z'.repeat(2000), fallbackUsed: 'none' },
      }),
    )
    const json = serializeToolLogsForPersistence(logs, 6000)
    const parsed = parseToolLogsPayloadJson(json, { mode: 'history-list' })

    expect(parsed.entries.length).toBeGreaterThan(0)
    for (const entry of parsed.entries) {
      expect(entry.status).toBe('success')
      expect(entry.details?.truncated).toBeUndefined()
      expect(entry.details?.storageTruncated).toBe(true)
    }
    const summary = summarize(parsed.entries)
    expect(summary.degraded).toBe(0)
    expect(summary.succeeded).toBe(parsed.entries.length)
  })
})
