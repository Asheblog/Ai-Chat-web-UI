import { buildTraceExport, buildLatexExport } from './task-trace-export-service'

describe('task-trace export service', () => {
  it('builds trace export with events', () => {
    const text = buildTraceExport({
      id: 1,
      status: 'done',
      actor: 'user:1',
      sessionId: 2,
      messageId: 3,
      clientMessageId: 'c1',
      traceLevel: 'full',
      startedAt: new Date('2024-01-01T00:00:00Z'),
      endedAt: null,
      durationMs: 1200,
      metadata: { k: 'v' },
      events: [
        { seq: 1, eventType: 'request', timestamp: '2024-01-01T00:00:05Z', payload: { a: 1 } },
        { seq: 2, timestamp: '2024-01-01T00:00:10Z', payload: { b: 2 } },
      ],
    })
    expect(text).toContain('Trace #1')
    expect(text).toContain('Status: done')
    expect(text).toContain('"k": "v"')
    expect(text).toContain('[0001]')
    expect(text).toContain('request')
    expect(text).toContain('"a": 1')
    expect(text).toContain('[0002]')
    expect(text).toContain('"b": 2')
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
})
