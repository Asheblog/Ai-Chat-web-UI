import { parseToolLogsPayloadJson, resolveMessageToolLogCoverage } from '../tool-log-parse'
import { LEGACY_COMPACTED_MARKER } from './tool-log-read-fixtures'

describe('旧 compacted marker：不是真实调用，过滤并以覆盖保留缺口', () => {
  test('旧 marker 被过滤，不产出成功条目，缺口写进 persisted', () => {
    const parsed = parseToolLogsPayloadJson(
      JSON.stringify([
        { id: 'call_1', tool: 'web_search', stage: 'result', status: 'success', createdAt: 1000 },
        LEGACY_COMPACTED_MARKER,
      ]),
    )

    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0].id).toBe('call_1')
    expect(parsed.entries[0].summary).toBeUndefined()
    expect(JSON.stringify(parsed.entries)).not.toContain('compacted')
    expect(parsed.coverage.persisted.status).toBe('partial')
    expect(parsed.coverage.persisted.droppedRecords).toBe(124)
  })

  test('只剩 marker 的旧消息也透出缺口，而不是显示成空日志', () => {
    const parsed = parseToolLogsPayloadJson(JSON.stringify([LEGACY_COMPACTED_MARKER]))
    expect(parsed.entries).toEqual([])
    expect(parsed.coverage.persisted.status).toBe('partial')
    expect(parsed.coverage.persisted.droppedRecords).toBe(124)
    expect(resolveMessageToolLogCoverage(parsed)).toBeTruthy()
  })

  test('summary 里没有条数的 marker 只标 partial，不编造数字', () => {
    const parsed = parseToolLogsPayloadJson(
      JSON.stringify([
        {
          id: 'compact-2',
          tool: 'web_search',
          stage: 'result',
          createdAt: 2,
          summary: 'tool events compacted to fit size limit',
          details: { truncated: true },
        },
      ]),
    )
    expect(parsed.entries).toEqual([])
    expect(parsed.coverage.persisted).toEqual({ status: 'partial' })
  })
})
