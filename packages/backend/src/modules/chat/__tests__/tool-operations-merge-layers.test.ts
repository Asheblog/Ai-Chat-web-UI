import {
  buildToolOperationIndex,
} from '@aichat/shared/tool-operations'
import type { ToolEvent } from '@aichat/shared/tool-operations'
import { event } from './tool-operations-fixtures'

describe('跨层优先级与确定性（D2）', () => {
  const hits = [{ title: 'T', url: 'https://t.example' }]

  const fullCopy = () =>
    event({
      id: 'x1',
      callId: 'x1',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 10,
      query: 'https://t.example',
      summary: '已读取',
      resultText: '完整正文',
      hits,
    })

  // projection 副本时间更晚、正文被裁剪、query 为空、hits 缺失
  const trimmedCopyA = () =>
    event({
      id: 'x1',
      callId: 'x1',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 99,
      query: '',
      summary: '已读取',
      resultText: '完整',
      details: { truncated: true },
    })

  const trimmedCopyB = () =>
    ({
      summary: '已读取',
      updatedAt: 99,
      details: { truncated: true },
      resultText: '完整',
      status: 'success',
      stage: 'result',
      createdAt: 10,
      query: '',
      callId: 'x1',
      tool: 'read_url',
      messageId: 1,
      sessionId: 1,
      id: 'x1',
    }) as ToolEvent

  test('trace 完整值不被更晚的 projection 裁剪值覆盖，且与对象 key 顺序无关', () => {
    for (const trimmed of [trimmedCopyA(), trimmedCopyB()]) {
      const index = buildToolOperationIndex({ trace: [fullCopy()], projection: [trimmed] })
      expect(index.records[0].event.resultText).toBe('完整正文')
      expect(index.records[0].event.hits).toEqual(hits)
      expect(index.records[0].event.query).toBe('https://t.example')
      // 截断副本没有提供任何最终展示值 → 不标截断、不降级
      expect(index.records[0].truncated).toBe(false)
      expect(index.records[0].degraded).toBe(false)
      expect(index.records[0].event.details?.truncated).toBeUndefined()
      expect(index.records[0].outcome).toBe('succeeded')
    }
  })

  test('层序 projection < persisted < trace < events：同层按时间，跨层按层', () => {
    const persistedOlder = event({
      id: 'x1',
      callId: 'x1',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 5,
      resultText: 'persisted 版本',
    })
    const index = buildToolOperationIndex({
      projection: [trimmedCopyA()],
      persisted: [persistedOlder],
      trace: [fullCopy()],
    })
    expect(index.records[0].event.resultText).toBe('完整正文')

    const sameLayerNewer = event({
      id: 'x1',
      callId: 'x1',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 50,
      resultText: 'trace 更晚版本',
    })
    const byTime = buildToolOperationIndex({ trace: [fullCopy(), sameLayerNewer] })
    expect(byTime.records[0].event.resultText).toBe('trace 更晚版本')
  })

  test('晚到的 start 即使时间更晚、层更低也不把终态降级', () => {
    const done = event({
      id: 'x2',
      callId: 'x2',
      tool: 'web_search',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 12,
    })
    const lateStart = event({
      id: 'x2',
      callId: 'x2',
      tool: 'web_search',
      stage: 'start',
      status: 'running',
      createdAt: 20,
      updatedAt: 30,
    })
    for (const input of [
      { trace: [done], persisted: [lateStart] },
      { trace: [lateStart], persisted: [done] },
    ]) {
      const record = buildToolOperationIndex(input).records[0]
      expect(record.status).toBe('success')
      expect(record.stage).toBe('result')
      expect(record.outcome).toBe('succeeded')
    }
  })
})


describe('截断按值来源判定（truncated 不残留）', () => {
  test('低层截断副本未提供任何最终值时，记录不标截断', () => {
    const complete = event({
      id: 'tr1',
      callId: 'tr1',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 10,
      resultText: '完整正文',
      summary: '已读取',
    })
    const truncated = event({
      id: 'tr1',
      callId: 'tr1',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 99,
      details: { truncated: true },
    })
    const record = buildToolOperationIndex({ trace: [complete], projection: [truncated] }).records[0]
    expect(record.event.resultText).toBe('完整正文')
    expect(record.event.details?.truncated).toBeUndefined()
    expect(record.truncated).toBe(false)
    expect(record.degraded).toBe(false)
  })

  test('最终值确实来自截断副本时如实标截断', () => {
    const complete = event({
      id: 'tr2',
      callId: 'tr2',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 10,
      resultText: '完整正文',
    })
    const truncated = event({
      id: 'tr2',
      callId: 'tr2',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 10,
      updatedAt: 99,
      summary: '仅剩摘要',
      details: { truncated: true },
    })
    const record = buildToolOperationIndex({ trace: [complete], projection: [truncated] }).records[0]
    expect(record.event.resultText).toBe('完整正文')
    expect(record.event.summary).toBe('仅剩摘要')
    expect(record.truncated).toBe(true)
    expect(record.degraded).toBe(true)
  })

  test('单一副本自标截断时记录仍标截断', () => {
    const only = event({
      id: 'tr3',
      callId: 'tr3',
      tool: 'read_url',
      stage: 'result',
      status: 'success',
      createdAt: 1,
      details: { truncated: true },
    })
    const record = buildToolOperationIndex([only]).records[0]
    expect(record.truncated).toBe(true)
    expect(record.event.details?.truncated).toBe(true)
  })
});
