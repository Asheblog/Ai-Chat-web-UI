import { ToolLogManager } from './tool-log-manager'

const buildManager = () => new ToolLogManager({ sessionId: 7 })

describe('ToolLogManager 统一记录字段', () => {
  test('写入身份/父子/状态/来源/时间字段，结束阶段补 endedAt', () => {
    const manager = buildManager()
    manager.record({
      id: 'call_1',
      callId: 'call_1',
      tool: 'web_search',
      stage: 'start',
      status: 'running',
      phase: 'executing',
      source: 'builtin',
      identifier: 'web_search',
      apiName: 'search',
      query: 'q',
    })

    const [entry] = manager.getLogs()
    expect(entry).toMatchObject({
      id: 'call_1',
      callId: 'call_1',
      status: 'running',
      phase: 'executing',
      source: 'builtin',
      identifier: 'web_search',
      apiName: 'search',
      query: 'q',
    })
    expect(typeof entry.updatedAt).toBe('number')
    expect(entry.endedAt).toBeUndefined()

    manager.record({
      id: 'call_1',
      tool: 'web_search',
      stage: 'result',
      status: 'success',
      summary: 'ok',
      details: { engine: 'tavily' },
    })

    const logs = manager.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      stage: 'result',
      status: 'success',
      summary: 'ok',
      createdAt: entry.createdAt,
    })
    expect(logs[0].details).toEqual({ engine: 'tavily' })
    expect(typeof logs[0].endedAt).toBe('number')
  })

  test('同 callId 的不同 id 各自成条，不合并子记录', () => {
    const manager = buildManager()
    manager.record({ id: 'call_p', callId: 'call_p', tool: 'web_search', stage: 'result' })
    manager.record({ id: 'call_p:read:1', callId: 'call_p', tool: 'read_url', stage: 'result' })
    expect(manager.getLogs().map((log) => log.id)).toEqual(['call_p', 'call_p:read:1'])
  })

  test('仅给 callId 时用它当记录 id，后续只给 callId 的更新仍能命中', () => {
    const manager = buildManager()
    manager.record({ callId: 'call_x', tool: 'web_search', stage: 'start', status: 'running' })
    manager.record({ callId: 'call_x', tool: 'web_search', stage: 'result', status: 'error' })
    const logs = manager.getLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ id: 'call_x', stage: 'result', status: 'error' })
  })

  test('details 多次记录合并而非覆盖', () => {
    const manager = buildManager()
    manager.record({ id: 'call_1', tool: 'read_url', stage: 'start', details: { taskType: 'read_url' } })
    manager.record({ id: 'call_1', tool: 'read_url', stage: 'error', details: { fallbackUsed: 'search_snippet' } })
    expect(manager.getLogs()[0].details).toEqual({
      taskType: 'read_url',
      fallbackUsed: 'search_snippet',
    })
  })

  test('toJson 输出 v2 信封并透传 runResult', () => {
    const manager = buildManager()
    manager.record({ id: 'call_1', tool: 'web_search', stage: 'result', status: 'success' })
    expect(manager.isDirty()).toBe(true)

    const json = manager.toJson({
      runResult: { stopReason: 'stop_tools', finalAnswerGenerated: false },
    })
    const payload = JSON.parse(json as string)
    expect(payload.v).toBe(2)
    expect(payload.entries).toHaveLength(1)
    expect(payload.runResult).toEqual({ stopReason: 'stop_tools', finalAnswerGenerated: false })
    expect(payload.coverage.trace.status).toBe('unknown')

    const plain = JSON.parse(manager.toJson() as string)
    expect(plain).not.toHaveProperty('runResult')
  })
})
