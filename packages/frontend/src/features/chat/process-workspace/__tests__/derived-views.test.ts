import { describe, expect, it } from 'vitest'
import {
  EMPTY_PROCESS_FILTER,
  buildProcessRows,
  filterProcessRecords,
  groupProcessAnomalies,
} from '../model/derived-views'
import {
  collectProcessSources,
  describeProcessRecord,
  resolveProcessActivity,
} from '../model/record-display'
import { buildProcessIndex } from '../model/process-model'
import type { ToolEvent } from '@/types'

const event = (id: string, override: Partial<ToolEvent> = {}): ToolEvent => ({
  id,
  callId: id,
  sessionId: 1,
  messageId: 1,
  tool: 'web_search',
  stage: 'result',
  status: 'success',
  createdAt: 1,
  ...override,
})

const parentChild = () => [
  event('root', { query: '中国新闻' }),
  event('child-1', { details: { parentCallId: 'root' }, query: '政策原文' }),
  event('child-2', { details: { parentCallId: 'root' }, status: 'error', stage: 'error', query: '产业报道' }),
]

describe('buildProcessRows 树形', () => {
  it('父调用在前，子任务缩进跟随后面', () => {
    const index = buildProcessIndex(parentChild())
    const rows = buildProcessRows(index, EMPTY_PROCESS_FILTER)
    expect(rows.map((row) => [row.id, row.depth])).toEqual([
      ['root', 0],
      ['child-1', 1],
      ['child-2', 1],
    ])
    expect(rows[0].hasChildren).toBe(true)
    expect(rows[1].hasChildren).toBe(false)
  })

  it('孤儿与歧义记录单独成组，不塞进任何父节点', () => {
    const index = buildProcessIndex([
      event('root'),
      event('orphan-1', { details: { parentCallId: 'missing' } }),
      event('p1', { callId: 'dup' }),
      event('p2', { callId: 'dup' }),
      event('amb-1', { callId: 'amb-1', details: { parentCallId: 'dup' } }),
    ])
    const rows = buildProcessRows(index, EMPTY_PROCESS_FILTER)
    const orphanRow = rows.find((row) => row.id === 'orphan-1')
    const ambRow = rows.find((row) => row.id === 'amb-1')
    expect(orphanRow?.group).toBe('orphan')
    expect(orphanRow?.depth).toBe(0)
    expect(ambRow?.group).toBe('ambiguous')
    // 树行先按 roots 顺序，再补未连接的记录；孤儿/歧义都不出现在任何父的子树里
    const rootRow = rows.find((row) => row.id === 'root')
    expect(rootRow?.group).toBe('tree')
    expect(rows.filter((row) => row.depth > 0)).toHaveLength(0)
  })

  it('时间线分组下全部为顶层行', () => {
    const index = buildProcessIndex(parentChild())
    const rows = buildProcessRows(index, { ...EMPTY_PROCESS_FILTER, grouping: 'timeline' })
    expect(rows.every((row) => row.depth === 0)).toBe(true)
    expect(rows).toHaveLength(3)
  })
})

describe('检索与筛选', () => {
  it('按查询词匹配工具、查询词与 callId', () => {
    const index = buildProcessIndex(parentChild())
    expect(filterProcessRecords(index, { ...EMPTY_PROCESS_FILTER, query: '政策' })).toHaveLength(1)
    expect(filterProcessRecords(index, { ...EMPTY_PROCESS_FILTER, query: 'child-2' })).toHaveLength(1)
    expect(filterProcessRecords(index, { ...EMPTY_PROCESS_FILTER, query: '中国' })).toHaveLength(1)
  })

  it('按结果状态筛选，只看异常包含失败/降级/归属未知', () => {
    const index = buildProcessIndex([
      event('ok'),
      event('bad', { status: 'error', stage: 'error' }),
      event('degraded', { details: { fallbackUsed: 'summary' } }),
      event('orphan', { details: { parentCallId: 'none' } }),
    ])
    expect(filterProcessRecords(index, { ...EMPTY_PROCESS_FILTER, status: 'failed' })).toHaveLength(1)
    expect(filterProcessRecords(index, { ...EMPTY_PROCESS_FILTER, status: 'degraded' })).toHaveLength(1)
    expect(filterProcessRecords(index, { ...EMPTY_PROCESS_FILTER, onlyAnomalies: true })).toHaveLength(3)
  })

  it('筛选后只保留命中记录；命中的子任务保留真实父链作为上下文行', () => {
    const index = buildProcessIndex(parentChild())
    const rows = buildProcessRows(index, { ...EMPTY_PROCESS_FILTER, query: '产业' })
    expect(rows.map((row) => [row.id, row.depth, Boolean(row.context)])).toEqual([
      ['root', 0, true],
      ['child-2', 1, false],
    ])
  })

  it('父命中但子不命中时不再把成功子任务一起带出（S-1）', () => {
    const index = buildProcessIndex([
      event('parent', { status: 'error', stage: 'error', query: '失败父' }),
      event('ok-child', { details: { parentCallId: 'parent' }, query: '成功子' }),
    ])
    const rows = buildProcessRows(index, { ...EMPTY_PROCESS_FILTER, status: 'failed' })
    expect(rows.map((row) => row.id)).toEqual(['parent'])
    expect(rows.some((row) => row.record.outcome === 'succeeded')).toBe(false)
  })

  it('工具筛选保留父调用作为上下文行，子任务不冒充顶层调用（S-2）', () => {
    const index = buildProcessIndex([
      event('p', { tool: 'web_search', query: '父' }),
      event('c', { tool: 'read_url', query: '子', details: { parentCallId: 'p' } }),
    ])
    const rows = buildProcessRows(index, { ...EMPTY_PROCESS_FILTER, tool: 'read_url' })
    expect(rows.map((row) => [row.id, row.depth, Boolean(row.context)])).toEqual([
      ['p', 0, true],
      ['c', 1, false],
    ])
    expect(rows.filter((row) => !row.context).map((row) => row.id)).toEqual(['c'])
  })
})

describe('异常分组', () => {
  it('失败、未获许可、中止、降级各自独立成组', () => {
    const index = buildProcessIndex([
      event('f', { status: 'error', stage: 'error' }),
      event('r', { status: 'rejected', stage: 'error' }),
      event('a', { status: 'aborted', stage: 'error' }),
      event('d', { details: { warning: '仅返回摘要' } }),
    ])
    const groups = groupProcessAnomalies(index)
    expect(groups.map((group) => group.kind)).toEqual(['failed', 'rejected', 'aborted', 'degraded'])
    expect(groups.find((group) => group.kind === 'failed')?.ids).toEqual(['f'])
  })

  it('没有异常时不产生空组', () => {
    expect(groupProcessAnomalies(buildProcessIndex([event('ok')]))).toEqual([])
  })
})

describe('来源去重', () => {
  it('同一 url 只留一条并保留引用序号与工具标签', () => {
    const index = buildProcessIndex([
      event('s1', {
        hits: [
          { title: '新华社报道', url: 'https://a.example/1' },
          { title: '央视新闻', url: 'https://b.example/2' },
        ],
      }),
      event('s2', { hits: [{ title: '新华社另一条', url: 'https://a.example/1#part' }] }),
    ])
    const sources = collectProcessSources(index)
    expect(sources).toHaveLength(2)
    expect(sources[0]).toMatchObject({ order: 1, title: '新华社报道' })
    expect(sources[0].tools).toEqual(['联网搜索'])
    expect(sources[1].order).toBe(2)
  })

  it('记录详情里的 url 也算来源，无 url 不产生来源', () => {
    const index = buildProcessIndex([
      event('r1', { tool: 'read_url', details: { url: 'https://c.example/3', title: '政策原文', siteName: '政府网' } }),
      event('r2', { tool: 'read_url', details: { title: '没有链接' } }),
    ])
    const sources = collectProcessSources(index)
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ title: '政策原文', siteName: '政府网' })
  })
})

describe('展示文案', () => {
  it('标题沿用 shared 的步骤标题', () => {
    const index = buildProcessIndex([event('q', { query: '中国新闻' })])
    expect(describeProcessRecord(index.records[0]).title).toBe('联网搜索：中国新闻')
  })

  it('流式活动取最后一条真实在途记录，等待审批单独表达', () => {
    const running = buildProcessIndex([
      event('done'),
      event('live', { status: 'running', stage: 'start', tool: 'read_url', query: '官方定价页' }),
    ])
    expect(resolveProcessActivity(running)).toBe('正在执行 · 网页读取：官方定价页')
    const waiting = buildProcessIndex([event('wait', { status: 'pending', stage: 'start' })])
    expect(resolveProcessActivity(waiting)).toBe('等待确认 · 联网搜索')
    expect(resolveProcessActivity(buildProcessIndex([event('done')]))).toBeNull()
  })
})
