import {
  buildToolLogCoverage,
  buildToolOperationIndex,
  buildToolOperationSummary,
  mergeToolOperationDuplicates,
  UNKNOWN_TOOL_LOG_COVERAGE,
} from '@aichat/shared/tool-operations'
import type { ToolEvent } from '@aichat/shared/tool-operations'
import { event } from './tool-operations-fixtures'

describe('ToolLogCoverage 三态与阶段/生命周期标签', () => {
  test('缺省覆盖为 unknown，不伪造完整', () => {
    expect(UNKNOWN_TOOL_LOG_COVERAGE).toEqual({
      trace: { status: 'unknown' },
      persisted: { status: 'unknown' },
      projection: { status: 'unknown' },
    })
    const index = buildToolOperationIndex([event({ id: 'x', tool: 'web_search' })])
    expect(index.coverage).toEqual(UNKNOWN_TOOL_LOG_COVERAGE)
    expect(buildToolOperationSummary(index).coverage).toEqual(UNKNOWN_TOOL_LOG_COVERAGE)
  })

  test('各层可分别声明 complete/partial/unknown 与计量字段', () => {
    const coverage = buildToolLogCoverage({
      trace: { status: 'partial', startedAt: 100, turnEndedAt: 200, droppedRecords: 2 },
      persisted: 'complete',
      projection: { status: 'unknown', truncatedFields: 7 },
    })
    expect(coverage.trace).toEqual({
      status: 'partial',
      startedAt: 100,
      turnEndedAt: 200,
      droppedRecords: 2,
    })
    expect(coverage.persisted).toEqual({ status: 'complete' })
    expect(coverage.projection).toEqual({ status: 'unknown', truncatedFields: 7 })

    const summary = buildToolOperationSummary(
      buildToolOperationIndex({ events: [event({ id: 'y', tool: 'web_search' })], coverage }),
    )
    expect(summary.coverage).toEqual(coverage)
  })

  test('截断标记保留在记录上，与执行结果分开', () => {
    const index = buildToolOperationIndex([
      event({
        id: 'trunc',
        tool: 'read_url',
        stage: 'result',
        status: 'success',
        details: { truncated: true },
      }),
    ])
    expect(index.records[0].truncated).toBe(true)
    expect(index.records[0].outcome).toBe('succeeded')
  })
})


describe('旧残片比较器（R5）', () => {
  const legacy = (callId: string): ToolEvent =>
    ({
      sessionId: 1,
      messageId: 1,
      tool: 'web_search',
      stage: 'start',
      status: 'running',
      callId,
      createdAt: 1000,
    }) as unknown as ToolEvent

  test('无 id 且 createdAt 相同的两条不同 callId 事件不抛异常且各自成条', () => {
    const a = legacy('legacy-a')
    const b = legacy('legacy-b')

    expect(() => mergeToolOperationDuplicates([a, b])).not.toThrow()
    expect(mergeToolOperationDuplicates([a, b]).events).toHaveLength(2)

    const index = buildToolOperationIndex([a, b])
    expect(index.records).toHaveLength(2)
    expect(index.records.map((record) => record.id).sort()).toEqual(['call:legacy-a', 'call:legacy-b'])
    expect(index.duplicateCount).toBe(0)

    // 顺序无关
    const reversed = buildToolOperationIndex([b, a])
    expect(reversed.records.map((record) => record.id).sort()).toEqual(['call:legacy-a', 'call:legacy-b'])
  })
});
