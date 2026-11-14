import {
  serializeToolLogsForPersistence,
  sanitizeToolLogEntryForPersistence,
} from '../tool-log-persistence'
import type { ToolLogEntry } from '../tool-log-model'

const entry = (override: Partial<ToolLogEntry> & Pick<ToolLogEntry, 'id'>): ToolLogEntry => ({
  tool: 'web_search',
  stage: 'result',
  createdAt: 1000,
  ...override,
})

const readEnvelope = (json: string | null) => {
  expect(json).not.toBeNull()
  return JSON.parse(json as string)
}

describe('toolLogs v2 信封', () => {
  test('写入 v/entries/coverage，runResult 完整往返', () => {
    const json = serializeToolLogsForPersistence(
      [entry({ id: 'call_1', status: 'success' })],
      { runResult: { stopReason: 'stop_tools', finalAnswerGenerated: false } },
    )
    const payload = readEnvelope(json)

    expect(payload.v).toBe(2)
    expect(payload.entries).toHaveLength(1)
    expect(payload.entries[0]).toMatchObject({ id: 'call_1', status: 'success' })
    expect(payload.runResult).toEqual({ stopReason: 'stop_tools', finalAnswerGenerated: false })
    expect(payload.coverage.persisted).toEqual({ status: 'complete', asOf: 1000 })
    expect(payload.coverage.trace).toEqual({ status: 'unknown' })
    expect(payload.coverage.projection).toEqual({ status: 'unknown' })
  })

  test('未传 runResult 时不写字段、不写假值', () => {
    const json = serializeToolLogsForPersistence([entry({ id: 'call_1' })])
    expect(json).not.toContain('runResult')
    expect(readEnvelope(json)).not.toHaveProperty('runResult')
  })

  test('runResult 只落实际提供的字段，缺的不补 false', () => {
    const json = serializeToolLogsForPersistence(
      [entry({ id: 'call_1' })],
      { runResult: { stopReason: 'budget_exhausted' } },
    )
    const payload = readEnvelope(json)
    expect(payload.runResult).toEqual({ stopReason: 'budget_exhausted' })
    expect(payload.runResult).not.toHaveProperty('finalAnswerGenerated')
  })

  test('未知 stopReason 或无有效字段时整段省略', () => {
    const json = serializeToolLogsForPersistence(
      [entry({ id: 'call_1' })],
      { runResult: { stopReason: 'cancelled' as never } },
    )
    expect(readEnvelope(json)).not.toHaveProperty('runResult')
  })

  test('第二参数仍接受 number（maxBytes），保持既有调用', () => {
    const logs = Array.from({ length: 8 }, (_, i) =>
      entry({ id: `call_${i}`, createdAt: 1000 + i, summary: 'x'.repeat(200) }),
    )
    const json = serializeToolLogsForPersistence(logs, 4096)
    expect(Buffer.byteLength(json as string, 'utf-8')).toBeLessThanOrEqual(4096)
    expect(readEnvelope(json).v).toBe(2)
  })

  test('空数组仍返回 null', () => {
    expect(serializeToolLogsForPersistence([])).toBeNull()
  })
})

describe('受限预算压缩：保留身份/父子/状态/来源/时间，计量丢记录与裁字段', () => {
  const buildLogs = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      entry({
        id: `call_${i}`,
        callId: `call_${i}`,
        stage: 'error',
        status: 'error',
        phase: 'error',
        source: 'builtin',
        createdAt: 1000 + i,
        endedAt: 1001 + i,
        summary: 's'.repeat(400),
        hits: [{ title: `t${i}`, url: `https://example.com/${i}`, snippet: 'n'.repeat(300) }],
        details: {
          parentCallId: 'parent_1',
          fallbackUsed: 'search_snippet',
          reasoningOffsetStart: i,
          excerpt: 'e'.repeat(2000),
        },
      }),
    )

  test('压缩后每条保留记录仍有 id/callId/status/source/phase/endedAt/parentCallId', () => {
    const logs = buildLogs(60)
    const payload = readEnvelope(serializeToolLogsForPersistence(logs, 6000))
    const kept = payload.entries as ToolLogEntry[]

    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(logs.length)
    for (const record of kept) {
      expect(record.id).toBeTruthy()
      expect(record.callId).toBe(record.id)
      expect(record.status).toBe('error')
      expect(record.stage).toBe('error')
      expect(record.source).toBe('builtin')
      expect(record.phase).toBe('error')
      expect(typeof record.createdAt).toBe('number')
      expect(typeof record.endedAt).toBe('number')
      expect(record.details?.parentCallId).toBe('parent_1')
      expect(record.details?.fallbackUsed).toBe('search_snippet')
    }
  })

  test('丢记录与裁字段分别计量，persisted 为 partial', () => {
    const logs = buildLogs(60)
    const payload = readEnvelope(serializeToolLogsForPersistence(logs, 6000))
    const persisted = payload.coverage.persisted

    expect(payload.coverage.trace.status).toBe('unknown')
    expect(persisted.status).toBe('partial')
    expect(persisted.droppedRecords).toBe(logs.length - payload.entries.length)
    expect(persisted.droppedRecords).toBeGreaterThan(0)
    expect(persisted.truncatedFields).toBeGreaterThan(0)
    expect(persisted.asOf).toBe(1060)
  })

  test('无丢记录且有字段被裁剪时仍是 partial，只记 truncatedFields', () => {
    const logs = [
      entry({
        id: 'call_1',
        summary: 'a'.repeat(4000),
        hits: [{ title: 't', url: 'u', snippet: 'b'.repeat(900) }],
      }),
    ]
    const payload = readEnvelope(serializeToolLogsForPersistence(logs, 4096))
    const persisted = payload.coverage.persisted
    expect(persisted.status).toBe('partial')
    expect(persisted).not.toHaveProperty('droppedRecords')
    expect(persisted.truncatedFields).toBeGreaterThan(0)
  })

  test('极小预算不伪造 compacted 成功条目，只如实记录丢记录数', () => {
    const logs = Array.from({ length: 5 }, (_, i) =>
      entry({ id: `call_${i}`, createdAt: 1000 + i, summary: 'z'.repeat(400) }),
    )
    const json = serializeToolLogsForPersistence(logs, 420)
    expect(json).not.toBeNull()
    expect(Buffer.byteLength(json as string, 'utf-8')).toBeLessThanOrEqual(420)
    expect(json as string).not.toContain('compacted')

    const payload = readEnvelope(json)
    const ids = (payload.entries as ToolLogEntry[]).map((record) => record.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(payload.coverage.persisted.droppedRecords).toBe(5 - payload.entries.length)
    for (const record of payload.entries as ToolLogEntry[]) {
      expect(record.tool).not.toBe('compacted')
      expect(record.summary ?? '').not.toContain('compacted')
    }
  })

  test('sanitize 保留新增身份字段且不修改原对象', () => {
    const source = entry({
      id: 'call_1',
      callId: 'call_1',
      status: 'aborted',
      phase: 'aborted',
      source: 'mcp',
      identifier: 'search_mcp',
      apiName: 'search',
      updatedAt: 1200,
      endedAt: 1300,
    })
    const sanitized = sanitizeToolLogEntryForPersistence(source)
    expect(sanitized).toMatchObject({
      id: 'call_1',
      callId: 'call_1',
      status: 'aborted',
      phase: 'aborted',
      source: 'mcp',
      identifier: 'search_mcp',
      apiName: 'search',
      updatedAt: 1200,
      endedAt: 1300,
    })
    expect(source).toMatchObject({ status: 'aborted', source: 'mcp' })
  })
})

describe('无工具记录时仍保留运行结果', () => {
  test('serialize([], { runResult }) 返回带 runResult 的空信封', () => {
    const json = serializeToolLogsForPersistence([], {
      runResult: { stopReason: 'stop_tools', finalAnswerGenerated: true },
    })
    const payload = readEnvelope(json)
    expect(payload.v).toBe(2)
    expect(payload.entries).toEqual([])
    expect(payload.runResult).toEqual({ stopReason: 'stop_tools', finalAnswerGenerated: true })
    expect(payload.coverage.persisted).toEqual({ status: 'complete' })
    expect(payload.coverage.trace).toEqual({ status: 'unknown' })
  })

  test('serialize([]) 与 serialize([], number) 仍返回 null', () => {
    expect(serializeToolLogsForPersistence([])).toBeNull()
    expect(serializeToolLogsForPersistence([], 4096)).toBeNull()
    expect(serializeToolLogsForPersistence([], { runResult: {} })).toBeNull()
  })
})

describe('S3：hit 字段按 shared 契约保留，删除项逐个计量', () => {
  test('engine/rank/sourceEngines/publishedDate 等字段不被静默丢弃', () => {
    const logs = [
      entry({
        id: 'call_1',
        hits: [
          {
            title: 'Result A',
            url: 'https://example.com/a',
            snippet: 'desc',
            content: 'c'.repeat(5000),
            engine: 'tavily',
            rank: 1,
            sourceEngines: ['tavily'],
            query: 'q',
            queryLanguage: 'en',
            mergeScore: 0.9,
            publishedDate: '2026-01-01',
            siteName: 'Example',
            authority: 3,
          },
        ],
      }),
    ]
    const payload = readEnvelope(serializeToolLogsForPersistence(logs))
    const hit = (payload.entries as ToolLogEntry[])[0].hits?.[0] as unknown as Record<string, unknown>

    expect(hit).toMatchObject({
      title: 'Result A',
      url: 'https://example.com/a',
      snippet: 'desc',
      engine: 'tavily',
      rank: 1,
      sourceEngines: ['tavily'],
      query: 'q',
      queryLanguage: 'en',
      mergeScore: 0.9,
      publishedDate: '2026-01-01',
      siteName: 'Example',
      authority: 3,
    })
    expect(hit).not.toHaveProperty('content')
  })

  test('每个被删掉的 hit 字段计一个 truncatedFields，不被宣布 complete', () => {
    const logs = [
      entry({
        id: 'call_1',
        hits: [
          { title: 'A', url: 'https://example.com/a', content: 'x'.repeat(100) },
          { title: 'B', url: 'https://example.com/b', content: 'y'.repeat(100), unknownField: 'z' },
        ],
      }),
    ]
    const payload = readEnvelope(serializeToolLogsForPersistence(logs))
    const persisted = payload.coverage.persisted

    expect(persisted.status).toBe('partial')
    // 第一条丢 content(1)；第二条丢 content + unknownField(2)
    expect(persisted.truncatedFields).toBe(3)
    expect(persisted).not.toHaveProperty('droppedRecords')
  })

  test('没有任何可丢字段的 hit 仍报 complete', () => {
    const logs = [
      entry({
        id: 'call_1',
        hits: [{ title: 'A', url: 'https://example.com/a' }],
      }),
    ]
    const payload = readEnvelope(serializeToolLogsForPersistence(logs))
    expect(payload.coverage.persisted).toEqual({ status: 'complete', asOf: 1000 })
  })
})
