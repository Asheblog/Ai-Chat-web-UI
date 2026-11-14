import {
  parseToolLogsJson,
  parseToolLogsPayloadJson,
  resolveMessageToolLogCoverage,
} from '../tool-log-parse'
import { serializeToolLogsForPersistence } from '../tool-log-persistence'
import { UNKNOWN_TOOL_LOG_COVERAGE } from '@aichat/shared/tool-operations'
import type { ToolLogEntry } from '../tool-log-model'
import { legacyArray } from './tool-log-read-fixtures'

describe('旧存储数组读取', () => {
  test('旧数组 persisted/trace 为 unknown，不冒充完整', () => {
    const parsed = parseToolLogsPayloadJson(legacyArray())
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.coverage.persisted).toEqual({ status: 'unknown' })
    expect(parsed.coverage.trace).toEqual({ status: 'unknown' })
    expect(parsed.coverage.projection).toEqual({ status: 'complete' })
    expect(parsed.runResult).toBeUndefined()
  })

  test('旧数组里带 truncated 标记也不升级为 complete', () => {
    const parsed = parseToolLogsPayloadJson(
      legacyArray({ details: { truncated: true, engine: 'tavily' } }),
    )
    expect(parsed.coverage.persisted.status).toBe('unknown')
    expect(parsed.entries[0].details?.truncated).toBe(true)
  })

  test('无持久化内容时三层均 unknown，且不暴露 coverage', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const parsed = parseToolLogsPayloadJson(raw)
      expect(parsed.entries).toEqual([])
      expect(parsed.coverage).toEqual(UNKNOWN_TOOL_LOG_COVERAGE)
      expect(resolveMessageToolLogCoverage(parsed)).toBeUndefined()
    }
  })

  test('旧空数组不产出 coverage（没有可报告的事实）', () => {
    const parsed = parseToolLogsPayloadJson('[]')
    expect(parsed.entries).toEqual([])
    expect(resolveMessageToolLogCoverage(parsed)).toBeUndefined()
  })

  test('损坏 JSON 返回空条目且 coverage unknown，不猜 complete', () => {
    const parsed = parseToolLogsPayloadJson('{not json')
    expect(parsed.entries).toEqual([])
    expect(parsed.coverage.persisted.status).toBe('unknown')
    expect(parsed.coverage.projection.status).toBe('unknown')
  })
})

describe('v2 信封读取', () => {
  const logs: ToolLogEntry[] = [
    { id: 'call_1', tool: 'web_search', stage: 'result', status: 'success', createdAt: 1000 },
  ]

  test('persisted 层来自信封，trace 恒为 unknown', () => {
    const json = serializeToolLogsForPersistence(logs, {
      runResult: { stopReason: 'stop_tools', finalAnswerGenerated: true },
    })
    const parsed = parseToolLogsPayloadJson(json)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.coverage.persisted).toEqual({ status: 'complete', asOf: 1000 })
    expect(parsed.coverage.trace).toEqual({ status: 'unknown' })
    expect(parsed.coverage.projection).toEqual({ status: 'complete' })
    expect(parsed.runResult).toEqual({ stopReason: 'stop_tools', finalAnswerGenerated: true })
  })

  test('信封声明 partial 时原样透出丢记录与裁字段', () => {
    const raw = JSON.stringify({
      v: 2,
      entries: [{ id: 'call_1', tool: 'web_search', stage: 'result', createdAt: 1000 }],
      coverage: {
        trace: { status: 'unknown' },
        persisted: { status: 'partial', asOf: 1000, droppedRecords: 3, truncatedFields: 2 },
        projection: { status: 'unknown' },
      },
    })
    const parsed = parseToolLogsPayloadJson(raw)
    expect(parsed.coverage.persisted).toEqual({
      status: 'partial',
      asOf: 1000,
      droppedRecords: 3,
      truncatedFields: 2,
    })
    expect(resolveMessageToolLogCoverage(parsed)).toBeTruthy()
  })

  test('信封缺 coverage 或字段非法时降为 unknown', () => {
    const missing = parseToolLogsPayloadJson(JSON.stringify({ v: 2, entries: [] }))
    expect(missing.coverage.persisted.status).toBe('unknown')

    const invalid = parseToolLogsPayloadJson(
      JSON.stringify({
        v: 2,
        entries: [],
        coverage: { persisted: { status: 'certain' } },
      }),
    )
    expect(invalid.coverage.persisted.status).toBe('unknown')
  })

  test('信封 runResult 只透出实际字段，不补 false', () => {
    const raw = JSON.stringify({
      v: 2,
      entries: [],
      coverage: { persisted: { status: 'complete' } },
      runResult: { stopReason: 'budget_exhausted' },
    })
    const parsed = parseToolLogsPayloadJson(raw)
    expect(parsed.runResult).toEqual({ stopReason: 'budget_exhausted' })
    expect(parsed.runResult).not.toHaveProperty('finalAnswerGenerated')
  })

  test('非 v2 未知形状按 unknown 处理，不静默当成空日志', () => {
    const parsed = parseToolLogsPayloadJson(JSON.stringify({ version: 1, logs: [] }))
    expect(parsed.entries).toEqual([])
    expect(parsed.coverage.persisted.status).toBe('unknown')
  })
})

describe('空 entries 信封的运行结果', () => {
  test('stop 发生在首个工具前也透出 runResult，且不编造记录缺口', () => {
    const raw = JSON.stringify({
      v: 2,
      entries: [],
      coverage: { trace: { status: 'unknown' }, persisted: { status: 'complete' } },
      runResult: { stopReason: 'stop_tools', finalAnswerGenerated: false },
    })
    const parsed = parseToolLogsPayloadJson(raw)
    expect(parsed.entries).toEqual([])
    expect(parsed.runResult).toEqual({ stopReason: 'stop_tools', finalAnswerGenerated: false })
    expect(parsed.coverage.persisted.status).toBe('complete')
    expect(resolveMessageToolLogCoverage(parsed)).toBeUndefined()
  })
})

describe('读取不虚构成功状态', () => {
  test('缺 status 的旧记录保持 undefined，不从 stage 编造', () => {
    const parsed = parseToolLogsJson(
      JSON.stringify([
        { id: 'call_1', tool: 'web_search', stage: 'result', createdAt: 1000 },
        { id: 'call_2', tool: 'web_search', stage: 'error', createdAt: 1001 },
      ]),
    )
    expect(parsed[0].status).toBeUndefined()
    expect(parsed[1].status).toBeUndefined()
  })

  test('parseToolLogsJson 仍只返回条目（既有调用方零改动）', () => {
    const entries = parseToolLogsJson(legacyArray())
    expect(Array.isArray(entries)).toBe(true)
    expect(entries[0].id).toBe('call_1')
    expect((entries[0] as unknown as Record<string, unknown>).coverage).toBeUndefined()
  })
})
