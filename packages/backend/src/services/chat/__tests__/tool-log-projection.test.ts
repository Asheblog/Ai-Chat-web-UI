import { parseToolLogsPayloadJson, resolveMessageToolLogCoverage } from '../tool-log-parse'
import { projectToolEventsForHistoryList } from '../tool-log-projection'
import type { ToolLogEntry } from '../tool-log-model'
import {
  HISTORY_LIST_PROJECTION_ENTRY,
  TRUNCATED_LIST_ENTRY,
} from './tool-log-read-fixtures'

describe('历史列表投影', () => {
  test('投影计量被省略的字段，并保留身份/父子/状态/来源/时间', () => {
    const entries: ToolLogEntry[] = [HISTORY_LIST_PROJECTION_ENTRY]
    const projected = parseToolLogsPayloadJson(JSON.stringify(entries), { mode: 'history-list' })

    expect(projected.entries[0]).toMatchObject({
      id: 'call_1',
      callId: 'call_1',
      status: 'success',
      phase: 'result',
      source: 'builtin',
      identifier: 'web_search',
      createdAt: 1000,
      updatedAt: 1200,
      endedAt: 1300,
    })
    expect(projected.entries[0].hits).toBeUndefined()
    expect(projected.entries[0].details).toMatchObject({
      parentCallId: 'parent_1',
      engine: 'tavily',
      fallbackUsed: 'search_snippet',
      reasoningOffsetStart: 10,
      hitsCount: 1,
    })
    expect(projected.entries[0].details).not.toHaveProperty('excerpt')
    expect(projected.coverage.projection.status).toBe('partial')
    expect(projected.coverage.projection.truncatedFields).toBeGreaterThan(0)
  })

  test('列表投影没有可省略字段时为 complete', () => {
    const entries: ToolLogEntry[] = [
      { id: 'call_1', tool: 'get_time_info', stage: 'result', status: 'success', createdAt: 1000 },
    ]
    const projected = parseToolLogsPayloadJson(JSON.stringify(entries), { mode: 'history-list' })
    expect(projected.entries[0].details).toBeUndefined()
    expect(projected.coverage.projection).toEqual({ status: 'complete' })
  })

  test('projectToolEventsForHistoryList 保持既有返回形状', () => {
    const entries: ToolLogEntry[] = [
      {
        id: 'call_1',
        tool: 'web_search',
        stage: 'result',
        createdAt: 1000,
        hits: [{ title: 't', url: 'u' }],
        details: { engine: 'tavily', excerpt: 'x' },
      },
    ]
    const slim = projectToolEventsForHistoryList(entries)
    expect(Array.isArray(slim)).toBe(true)
    expect(slim[0].hits).toBeUndefined()
    expect(slim[0].details).toEqual({ engine: 'tavily', hitsCount: 1 })
  })
})

describe('S1：列表投影保留 truncated 降级证据，且不报 complete', () => {
  test('truncated 不被列表投影吞掉，投影计量为 partial', () => {
    const projected = parseToolLogsPayloadJson(
      JSON.stringify({
        v: 2,
        entries: [TRUNCATED_LIST_ENTRY],
        coverage: { persisted: { status: 'partial', truncatedFields: 1 } },
      }),
      { mode: 'history-list' },
    )

    expect(projected.entries[0].details?.truncated).toBe(true)
    expect(projected.entries[0].hits).toBeUndefined()
    expect(projected.entries[0].details).not.toHaveProperty('excerpt')
    expect(projected.coverage.projection.status).toBe('partial')
    expect(projected.coverage.projection.truncatedFields).toBe(2)
  })

  test('只有 truncated 的记录不再被宣布「没省略任何字段」的路径仍可读', () => {
    const projected = parseToolLogsPayloadJson(
      JSON.stringify([
        { id: 'call_2', tool: 'read_url', stage: 'result', status: 'success', createdAt: 1, details: { truncated: true } },
      ]),
      { mode: 'history-list' },
    )
    expect(projected.entries[0].details?.truncated).toBe(true)
    expect(projected.coverage.persisted.status).toBe('unknown')
  })
})

describe('空值不制造假缺口', () => {
  test('空 hits / 空串 query / 非法 status 不计入投影缺口', () => {
    const parsed = parseToolLogsPayloadJson(
      JSON.stringify([
        {
          id: 'call_1',
          tool: 'web_search',
          stage: 'result',
          status: 'weird-status',
          query: '',
          createdAt: 1000,
          hits: [],
        },
      ]),
    )
    expect(parsed.coverage.projection).toEqual({ status: 'complete' })
  })

  test('空 entries 但确有丢记录时仍透出覆盖', () => {
    const parsed = parseToolLogsPayloadJson(
      JSON.stringify({
        v: 2,
        entries: [],
        coverage: { persisted: { status: 'partial', droppedRecords: 3 } },
      }),
    )
    expect(parsed.entries).toEqual([])
    expect(resolveMessageToolLogCoverage(parsed)?.persisted.droppedRecords).toBe(3)
  })
})
