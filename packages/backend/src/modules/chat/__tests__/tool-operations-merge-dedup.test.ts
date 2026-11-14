import {
  buildToolOperationIndex,
  buildToolOperationSummary,
  mergeToolOperationDuplicates,
} from '@aichat/shared/tool-operations'
import type { ToolEvent } from '@aichat/shared/tool-operations'
import { event } from './tool-operations-fixtures'

describe('同 id 重复与乱序事件', () => {
  test('同 id 的 start/result 合并为一条记录，顺序无关且不重复计数', () => {
    const result = event({
      id: 't1',
      callId: 't1',
      tool: 'get_time_info',
      createdAt: 10,
      updatedAt: 12,
      stage: 'result',
      status: 'success',
      resultText: '{"now":"2026-11-14"}',
    })
    const start = event({
      id: 't1',
      callId: 't1',
      tool: 'get_time_info',
      createdAt: 10,
      stage: 'start',
      status: 'running',
      argumentsText: '{}',
    })

    const ordered = buildToolOperationIndex([start, result])
    const reversed = buildToolOperationIndex([result, start])

    for (const index of [ordered, reversed]) {
      expect(index.records).toHaveLength(1)
      const record = index.records[0]
      expect(record.id).toBe('t1')
      expect(record.stage).toBe('result')
      expect(record.status).toBe('success')
      expect(record.outcome).toBe('succeeded')
      expect(record.duplicateCount).toBe(1)
      expect(record.event.resultText).toBe('{"now":"2026-11-14"}')
      expect(record.event.argumentsText).toBe('{}')
    }
    expect(buildToolOperationSummary(ordered)).toEqual(buildToolOperationSummary(reversed))
    expect(buildToolOperationSummary(ordered).totalOperations).toBe(1)
    expect(buildToolOperationSummary(ordered).stages).toEqual({ start: 0, result: 1, error: 0 })
  })

  test('重复 error 事件只按唯一记录计一次失败', () => {
    const failed = event({
      id: 'f1',
      tool: 'python_runner',
      stage: 'error',
      status: 'error',
      error: 'exit code 1',
      createdAt: 5,
    })
    const index = buildToolOperationIndex([failed, { ...failed, updatedAt: 6 }])
    const summary = buildToolOperationSummary(index)
    expect(index.records).toHaveLength(1)
    expect(index.records[0].duplicateCount).toBe(1)
    expect(summary.failedOperations).toBe(1)
    expect(summary.statuses.error).toBe(1)
    expect(summary.stages.error).toBe(1)
  })

  test('迟到的 start 不把已结束记录降级为运行中（mergeToolOperationDuplicates）', () => {
    const merged = mergeToolOperationDuplicates([
      event({ id: 'm1', tool: 'web_search', stage: 'result', status: 'success', createdAt: 9 }),
      event({ id: 'm1', tool: 'web_search', stage: 'start', status: 'running', createdAt: 8 }),
      event({ id: 'm1', tool: 'web_search', stage: 'start', status: 'running', createdAt: 7 }),
    ])
    expect(merged.events).toHaveLength(1)
    expect(merged.duplicatesMerged).toBe(2)
    expect(merged.events[0].stage).toBe('result')
    expect(merged.events[0].status).toBe('success')
  })

  test('跨来源（trace/persisted/projection）同 id 去重并保留更完整字段', () => {
    const index = buildToolOperationIndex({
      trace: [
        event({
          id: 'src-1',
          tool: 'read_url',
          stage: 'result',
          status: 'success',
          resultText: '完整正文',
          createdAt: 3,
        }),
      ],
      persisted: [
        event({
          id: 'src-1',
          tool: 'read_url',
          stage: 'result',
          status: 'success',
          summary: '已读取',
          createdAt: 3,
          details: { truncated: true },
        }),
      ],
      projection: [event({ id: 'src-1', tool: 'read_url', stage: 'result', createdAt: 3 })],
    })
    expect(index.records).toHaveLength(1)
    expect(index.records[0].event.resultText).toBe('完整正文')
    expect(index.records[0].event.summary).toBe('已读取')
    expect(index.duplicateCount).toBe(2)
  })
})


describe('同 id 副本字段保全（D1）', () => {
  const hits = [
    { title: 'A', url: 'https://a.example' },
    { title: 'B', url: 'https://b.example' },
  ]

  test('start 无 hits + result 有 hits：合并后 hits/query/summary 全保留', () => {
    const start = event({
      id: 's1',
      callId: 's1',
      tool: 'web_search',
      stage: 'start',
      status: 'running',
      query: '今日新闻',
      createdAt: 10,
    })
    const result = event({
      id: 's1',
      callId: 's1',
      tool: 'web_search',
      stage: 'result',
      status: 'success',
      createdAt: 11,
      updatedAt: 12,
      hits,
      summary: '并行搜索完成：1 引擎命中 2 条',
    })

    for (const input of [[start, result], [result, start]]) {
      const record = buildToolOperationIndex(input).records[0]
      expect(record.event.hits).toEqual(hits)
      expect(record.event.query).toBe('今日新闻')
      expect(record.event.summary).toBe('并行搜索完成：1 引擎命中 2 条')
      expect(record.status).toBe('success')
      expect(record.stage).toBe('result')
    }
  })

  test('真实 ToolEvent 上的任意字段都不因合并丢失', () => {
    const first = event({
      id: 'm1',
      callId: 'm1',
      tool: 'read_url',
      stage: 'start',
      status: 'running',
      createdAt: 1,
      argumentsText: '{"url":"https://x"}',
      details: { url: 'https://x', autoTriggered: true },
    })
    const second = event({
      id: 'm1',
      callId: 'm1',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 2,
      resultText: '正文',
      thoughtSignature: 'sig-1',
      details: { wordCount: 12 },
    })
    const record = buildToolOperationIndex([first, second]).records[0]
    expect(record.event.argumentsText).toBe('{"url":"https://x"}')
    expect(record.event.resultText).toBe('正文')
    expect(record.event.thoughtSignature).toBe('sig-1')
    expect(record.event.details).toMatchObject({ url: 'https://x', autoTriggered: true, wordCount: 12 })
  })
})
