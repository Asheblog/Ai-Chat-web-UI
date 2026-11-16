import { buildLatexExport, buildTraceExport } from './task-trace-export-service'

const baseTrace = () => ({
  id: 105,
  status: 'completed',
  actor: 'user:1',
  sessionId: 2,
  messageId: 3,
  clientMessageId: 'c1',
  traceLevel: 'explicit',
  startedAt: new Date('2024-01-01T00:00:00Z'),
  endedAt: null,
  durationMs: 148077,
  metadata: { k: 'v' },
  events: [
    { seq: 1, eventType: 'request', timestamp: '2024-01-01T00:00:05Z', payload: { a: 1 } },
    { seq: 2, timestamp: '2024-01-01T00:00:10Z', payload: { b: 2 } },
  ],
})

describe('task-trace export service', () => {
  it('builds trace export with events', () => {
    const text = buildTraceExport(baseTrace())
    expect(text).toContain('Trace #105')
    expect(text).toContain('Status: completed')
    expect(text).toContain('"k": "v"')
    expect(text).toContain('[0001]')
    expect(text).toContain('request')
    expect(text).toContain('"a": 1')
    expect(text).toContain('[0002]')
    expect(text).toContain('"b": 2')
  })

  it('states missing event files instead of shipping a silently empty export', () => {
    const text = buildTraceExport({
      ...baseTrace(),
      events: [],
      integrity: {
        fileStatus: 'missing',
        corruptLines: 0,
        exportTruncated: false,
        missingReason: '追踪事件文件缺失：/app/logs/task-trace/trace-105.log',
      },
    })

    expect(text).toContain('File status: missing')
    expect(text).toContain('追踪事件文件缺失')
    expect(text).toContain('本次导出仅包含数据库元数据')
    expect(text).toContain('--- Events ---')
  })

  it('reports omitted events and unparsed lines so a partial export never looks complete', () => {
    const text = buildTraceExport({
      ...baseTrace(),
      eventCount: 2212,
      integrity: {
        fileStatus: 'partial',
        corruptLines: 3,
        exportTruncated: false,
        omitted: { noise: 150, normal: 0, critical: 2 },
        overflow: { noise: true, normal: false, critical: true },
      },
    })

    expect(text).toContain('File status: partial')
    expect(text).toContain('Event count (persisted): 2212')
    expect(text).toContain('Unparsed lines: 3')
    expect(text).toContain('Omitted events: noise=150, normal=0, critical=2')
    expect(text).toContain('噪声或超限事件未写入')
  })

  it('keeps the export header free of omission noise when nothing was lost', () => {
    const text = buildTraceExport({
      ...baseTrace(),
      eventCount: 2,
      integrity: {
        fileStatus: 'ok',
        corruptLines: 0,
        exportTruncated: false,
        omitted: { noise: 0, normal: 0, critical: 0 },
      },
    })

    expect(text).toContain('File status: ok')
    expect(text).not.toContain('Omitted events:')
    expect(text).not.toContain('Unparsed lines:')
  })

  it('builds latex export with metadata and events', () => {
    const text = buildLatexExport({
      id: 5,
      taskTraceId: 6,
      status: 'ok',
      matchedBlocks: 1,
      unmatchedBlocks: 0,
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:01:00Z',
      metadata: { foo: 'bar' },
      events: [{ seq: 1, matched: true }],
    })
    expect(text).toContain('Latex Trace #5 (Task Trace #6)')
    expect(text).toContain('Matched Blocks: 1')
    expect(text).toContain('"foo": "bar"')
    expect(text).toContain('{"seq":1,"matched":true}')
  })

  it('states a missing latex event file', () => {
    const text = buildLatexExport({
      id: 5,
      taskTraceId: 6,
      status: 'ok',
      matchedBlocks: 1,
      unmatchedBlocks: 0,
      createdAt: null,
      updatedAt: null,
      metadata: null,
      events: [],
      integrity: { fileStatus: 'missing', corruptLines: 0, exportTruncated: false },
    })
    expect(text).toContain('File status: missing')
    expect(text).toContain('本次导出仅包含数据库元数据')
  })
})