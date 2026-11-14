import { ToolLogManager } from '../tool-log-manager'
import { normalizeToolCallEventPayload } from '../../../agent-runtime/tool-call-event'
import { parseToolLogsPayloadJson } from '../../../services/chat/tool-log-parse'

const recordEvent = (manager: ToolLogManager, payload: Record<string, unknown>) => {
  // 与 agent-web-search-response.sendToolEvent 完全相同的入口：先归一化，再进台账
  manager.record(normalizeToolCallEventPayload(payload))
}

const readPersisted = (json: string | null) => {
  expect(json).toBeTruthy()
  return parseToolLogsPayloadJson(json as string, { mode: 'full' })
}

describe('agent tool log recording', () => {
  it('keeps real MCP source/identifier/apiName and the terminal endedAt through persistence', () => {
    const manager = new ToolLogManager({ sessionId: 7 })

    recordEvent(manager, {
      type: 'tool_call',
      id: 'call_mcp_1',
      callId: 'call_mcp_1',
      tool: 'files.read',
      source: 'mcp',
      identifier: 'files.read',
      apiName: 'read_file',
      stage: 'start',
      status: 'running',
      phase: 'executing',
      details: { input: '{"path":"README.md"}' },
    })

    recordEvent(manager, {
      type: 'tool_call',
      id: 'call_mcp_1',
      callId: 'call_mcp_1',
      tool: 'files.read',
      source: 'mcp',
      identifier: 'files.read',
      apiName: 'read_file',
      stage: 'result',
      status: 'success',
      phase: 'result',
      summary: '读取 3 行',
    })

    const json = manager.toJson()
    const payload = readPersisted(json)
    expect(payload.entries).toHaveLength(1)

    const entry = payload.entries[0]
    expect(entry).toMatchObject({
      id: 'call_mcp_1',
      tool: 'files.read',
      stage: 'result',
      status: 'success',
      phase: 'result',
      source: 'mcp',
      identifier: 'files.read',
      apiName: 'read_file',
    })
    expect(typeof entry.createdAt).toBe('number')
    expect(typeof entry.updatedAt).toBe('number')
    expect(typeof entry.endedAt).toBe('number')
    expect(entry.endedAt as number).toBeGreaterThanOrEqual(entry.createdAt)

    // 身份与来源必须真的写进磁盘形状，而不是只存在内存条目里
    expect(json).toContain('"source":"mcp"')
    expect(json).toContain('"identifier":"files.read"')
    expect(json).toContain('"apiName":"read_file"')
    expect(json).toContain('"endedAt"')
  })

  it('records the skipped-call aborted event emitted by stop-tools without faking success', () => {
    const manager = new ToolLogManager({ sessionId: 9 })

    recordEvent(manager, {
      type: 'tool_call',
      id: 'call_skipped',
      callId: 'call_skipped',
      tool: 'python_runner',
      source: 'builtin',
      identifier: 'python_runner',
      stage: 'result',
      status: 'aborted',
      phase: 'aborted',
      summary: '已停止工具调用，未执行',
      details: { stopReason: 'stop_tools', skipped: true },
    })

    const entry = readPersisted(manager.toJson()).entries[0]
    expect(entry).toMatchObject({
      id: 'call_skipped',
      stage: 'result',
      status: 'aborted',
      phase: 'aborted',
      source: 'builtin',
    })
    expect(entry.status).not.toBe('success')
    expect(entry.details).toMatchObject({ stopReason: 'stop_tools', skipped: true })
    expect(typeof entry.endedAt).toBe('number')
  })

  it('keeps one entry per call id and does not resurrect a cleared dirty flag', () => {
    const manager = new ToolLogManager({ sessionId: 11 })
    expect(manager.isDirty()).toBe(false)

    recordEvent(manager, {
      type: 'tool_call',
      id: 'call_dirty',
      tool: 'web_search',
      stage: 'start',
      status: 'running',
    })
    expect(manager.isDirty()).toBe(true)
    expect(manager.toJson()).toContain('"v":2')

    manager.markClean()
    expect(manager.isDirty()).toBe(false)

    recordEvent(manager, {
      type: 'tool_call',
      id: 'call_dirty',
      tool: 'web_search',
      stage: 'result',
      status: 'success',
    })
    expect(manager.isDirty()).toBe(true)
    expect(manager.getLogs()).toHaveLength(1)
    expect(manager.getLogs()[0]).toMatchObject({ stage: 'result', status: 'success' })
  })
})
