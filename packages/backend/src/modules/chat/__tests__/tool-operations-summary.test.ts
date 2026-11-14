import {
  buildToolOperationIndex,
  buildToolOperationSummary,
  isToolOperationDegraded,
  resolveToolOperationOutcome,
  resolveToolOperationRecovery,
} from '@aichat/shared/tool-operations'
import { childOf, event, parentCall } from './tool-operations-fixtures'

describe('status / outcome / recovery 分离', () => {
  test('rejected、aborted、error 各自独立，不从错误文本猜状态', () => {
    const rejected = event({
      id: 'rejected',
      tool: 'export_pdf',
      stage: 'error',
      status: 'rejected',
      intervention: { status: 'rejected', rejectedReason: '用户拒绝' },
    })
    const aborted = event({ id: 'aborted', tool: 'python_runner', status: 'aborted', stage: 'error' })
    const failed = event({
      id: 'failed',
      tool: 'python_runner',
      stage: 'error',
      status: 'error',
      error: 'permission denied: aborted by user',
    })
    const index = buildToolOperationIndex([rejected, aborted, failed])
    const byId = new Map(index.records.map((record) => [record.id, record]))

    expect(byId.get('rejected')?.status).toBe('rejected')
    expect(byId.get('rejected')?.outcome).toBe('rejected')
    expect(byId.get('aborted')?.status).toBe('aborted')
    expect(byId.get('aborted')?.outcome).toBe('aborted')
    expect(byId.get('failed')?.status).toBe('error')
    expect(byId.get('failed')?.outcome).toBe('failed')

    const summary = buildToolOperationSummary(index)
    expect(summary.failedOperations).toBe(1)
    expect(summary.rejected).toBe(1)
    expect(summary.aborted).toBe(1)
  })

  test('status=error 但 intervention 明确拒绝时 outcome 记为 rejected（未获许可≠失败）', () => {
    const index = buildToolOperationIndex([
      event({
        id: 'error-rejected',
        tool: 'export_pdf',
        stage: 'error',
        status: 'error',
        error: 'tool execution failed',
        intervention: { status: 'rejected', rejectedReason: '未获许可' },
      }),
    ])
    expect(index.records[0].status).toBe('error')
    expect(index.records[0].outcome).toBe('rejected')
    const summary = buildToolOperationSummary(index)
    expect(summary.failedOperations).toBe(0)
    expect(summary.rejected).toBe(1)
  })

  test('pending 归入 in_flight，缺 status 的旧记录按 stage 推导', () => {
    const pending = event({ id: 'pending', tool: 'research_plan', status: 'pending', stage: 'start' })
    const legacyStart = event({ id: 'legacy-start', tool: 'web_search', status: undefined })
    const legacyError = event({
      id: 'legacy-error',
      tool: 'web_search',
      stage: 'error',
      status: undefined,
      createdAt: 2,
    })
    const index = buildToolOperationIndex([pending, legacyStart, legacyError])
    const byId = new Map(index.records.map((record) => [record.id, record]))

    expect(byId.get('pending')?.outcome).toBe('in_flight')
    expect(byId.get('legacy-start')?.outcome).toBe('in_flight')
    expect(byId.get('legacy-error')?.outcome).toBe('failed')
    expect(resolveToolOperationOutcome(pending)).toBe('in_flight')
    expect(resolveToolOperationOutcome(legacyError)).toBe('failed')

    const summary = buildToolOperationSummary(index)
    expect(summary.inFlight).toBe(2)
    expect(summary.failedOperations).toBe(1)
  })

  test('fallback/attempts 只来自确证字段，无证据不写次数', () => {
    const withFallback = event({
      id: 'read-1',
      tool: 'read_url',
      stage: 'error',
      status: 'error',
      details: {
        fallbackUsed: 'search_snippet',
        attempts: [
          { engine: 'native', status: 'error' },
          { engine: 'crawler', status: 'success' },
        ],
      },
    })
    const noFallback = event({
      id: 'read-2',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      details: { fallbackUsed: 'none' },
    })
    const noEvidence = event({ id: 'read-3', tool: 'read_url', stage: 'result', status: 'success' })

    expect(resolveToolOperationRecovery(withFallback)).toEqual({
      fallbackUsed: 'search_snippet',
      attempts: 2,
      retried: true,
    })
    expect(resolveToolOperationRecovery(noFallback)).toEqual({})
    expect(resolveToolOperationRecovery(noEvidence)).toEqual({})
    expect(isToolOperationDegraded(withFallback)).toBe(true)
    expect(isToolOperationDegraded(noFallback)).toBe(false)

    const index = buildToolOperationIndex([withFallback, noFallback, noEvidence])
    const summary = buildToolOperationSummary(index)
    expect(summary.attempts).toBe(2)
    expect(summary.attemptsEvidence).toBe('partial')
    expect(summary.degraded).toBe(1)
    expect(summary.failedOperations).toBe(1)
    expect(summary.succeeded).toBe(2)
  })

  test('无任何 attempts 证据时 attempts 为 null、attemptsEvidence 为 unknown', () => {
    const summary = buildToolOperationSummary(
      buildToolOperationIndex([event({ id: 'plain', tool: 'get_time_info', stage: 'result', status: 'success' })]),
    )
    expect(summary.attempts).toBeNull()
    expect(summary.attemptsEvidence).toBe('unknown')
  })
})


describe('受影响父调用按根去重', () => {
  test('同一根下多条失败/拒绝只计一个受影响父调用', () => {
    const index = buildToolOperationIndex([
      parentCall('p'),
      childOf('p', 'p:search:initial:1', { stage: 'error', status: 'error', createdAt: 11 }),
      childOf('p', 'p:read:1', { stage: 'error', status: 'rejected', createdAt: 12 }),
      parentCall('q'),
      childOf('q', 'q:read:1', { createdAt: 21 }),
      event({ id: 'r', tool: 'export_pdf', stage: 'error', status: 'error', createdAt: 30 }),
    ])
    const summary = buildToolOperationSummary(index)
    expect(summary.failedOperations).toBe(2)
    expect(summary.rejected).toBe(1)
    expect(summary.parentCalls).toBe(3)
    expect(summary.subtasks).toBe(3)
    expect(summary.affectedParentCalls).toBe(2)
  })

  test('全部成功的根不计入受影响父调用', () => {
    const summary = buildToolOperationSummary(
      buildToolOperationIndex([parentCall('ok'), childOf('ok', 'ok:read:1', { createdAt: 11 })]),
    )
    expect(summary.affectedParentCalls).toBe(0)
    expect(summary.failedOperations).toBe(0)
  })
})


describe('intervention 优先规则', () => {
  test('pending + intervention aborted 记为 aborted（统一优先：显式终止证据胜过生命周期）', () => {
    const pendingAborted = event({
      id: 'pa',
      tool: 'web_search',
      status: 'pending',
      stage: 'start',
      intervention: { status: 'aborted' },
    })
    expect(resolveToolOperationOutcome(pendingAborted)).toBe('aborted')
  })
});
