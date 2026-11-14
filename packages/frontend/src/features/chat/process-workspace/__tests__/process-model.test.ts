import { describe, expect, it } from 'vitest'
import {
  buildProcessIndex,
  buildProcessSummary,
  normalizeProcessCoverage,
} from '../model/process-model'
import type { ToolEvent } from '@/types'

const base = (id: string, override: Partial<ToolEvent> = {}): ToolEvent => ({
  id,
  sessionId: 1,
  messageId: 1,
  tool: 'web_search',
  stage: 'result',
  status: 'success',
  createdAt: 1,
  ...override,
})

describe('buildProcessIndex 身份与关系', () => {
  it('同 id 重复事件合并为一条记录，与到达顺序无关', () => {
    const start = base('a', { stage: 'start', status: 'running', createdAt: 1 })
    const done = base('a', { stage: 'result', status: 'success', createdAt: 1, resultText: '结果' })
    const forward = buildProcessIndex([start, done])
    const backward = buildProcessIndex([done, start])
    expect(forward.records).toHaveLength(1)
    expect(backward.records).toHaveLength(1)
    expect(forward.records[0].status).toBe('success')
    expect(backward.records[0].status).toBe('success')
    expect(forward.records[0].duplicateCount).toBe(1)
    expect(forward.records[0].event.resultText).toBe('结果')
  })

  it('不同 id 共享 callId 不合并，父候选因此歧义且不归入任何 children', () => {
    const parentA = base('p1', { callId: 'shared' })
    const parentB = base('p2', { callId: 'shared' })
    const child = base('c1', { callId: 'c1', details: { parentCallId: 'shared' } })
    const index = buildProcessIndex([parentA, parentB, child])
    expect(index.records).toHaveLength(3)
    expect(index.ambiguous).toEqual(['c1'])
    // children 是稠密表：每条记录都有键，歧义记录不挂在任何父下
    expect(index.children.c1).toEqual([])
    expect(Object.values(index.children).flat()).not.toContain('c1')
    expect(index.records.find(r => r.id === 'c1')?.relation).toBe('ambiguous')
    // ambiguousParents[callId] 给的是候选父记录 id，界面据此说明"父候选不唯一"
    expect(index.ambiguousParents).toEqual({ shared: ['p1', 'p2'] })
  })

  it('parentCallId 唯一匹配时连接父子，父调用与子任务分开计数', () => {
    const parent = base('p1', { callId: 'p1' })
    const child = base('c1', { callId: 'c1', details: { parentCallId: 'p1' } })
    const index = buildProcessIndex([parent, child])
    expect(index.roots).toEqual(['p1'])
    expect(index.children.p1).toEqual(['c1'])
    expect(index.children.c1).toEqual([])
    expect(index.ambiguous).toEqual([])
    expect(index.orphans).toEqual([])
  })

  it('无父候选的记录是孤儿，不虚构父节点', () => {
    const orphan = base('o1', { details: { parentCallId: 'missing' } })
    const index = buildProcessIndex([orphan])
    expect(index.orphans).toEqual(['o1'])
    expect(index.roots).toEqual([])
    expect(index.records[0].parentId).toBeNull()
    expect(index.records[0].relation).toBe('orphan')
  })

  it('子记录指向自身 callId 时不算自己的父', () => {
    const self = base('s1', { callId: 's1', details: { parentCallId: 's1' } })
    const index = buildProcessIndex([self])
    expect(index.orphans).toEqual(['s1'])
    expect(index.children.s1).toEqual([])
  })
})

describe('buildProcessIndex 结果推导只使用确证字段', () => {
  it('error + intervention.rejected 是未获许可，不是普通失败', () => {
    const rejected = base('r1', {
      status: 'error',
      stage: 'error',
      intervention: { status: 'rejected' } as ToolEvent['intervention'],
    })
    expect(buildProcessIndex([rejected]).records[0].outcome).toBe('rejected')
  })

  it('running + intervention.aborted 是中止', () => {
    const aborted = base('a1', {
      status: 'running',
      stage: 'start',
      intervention: { status: 'aborted' } as ToolEvent['intervention'],
    })
    expect(buildProcessIndex([aborted]).records[0].outcome).toBe('aborted')
  })

  it('英文错误文本不参与状态推断', () => {
    const failed = base('e1', { status: 'error', stage: 'error', error: 'permission denied by user cancel' })
    expect(buildProcessIndex([failed]).records[0].outcome).toBe('failed')
  })

  it('回退证据单独标记降级，成功仍是成功', () => {
    const degraded = base('d1', { details: { fallbackUsed: 'summary' } })
    const record = buildProcessIndex([degraded]).records[0]
    expect(record.outcome).toBe('succeeded')
    expect(record.degraded).toBe(true)
    expect(record.recovery.fallbackUsed).toBe('summary')
  })

  it("fallbackUsed='none' 不算降级证据", () => {
    const plain = base('d2', { details: { fallbackUsed: 'none' } })
    const record = buildProcessIndex([plain]).records[0]
    expect(record.degraded).toBe(false)
    expect(record.recovery.fallbackUsed).toBeUndefined()
  })

  it('没有 attempts 证据时不产生次数（不显示 0）', () => {
    const record = buildProcessIndex([base('n1')]).records[0]
    expect(record.recovery.attempts).toBeUndefined()
    expect(record.recovery.retried).toBeUndefined()
  })

  it('有 attempts 数组证据时按数组长度计数并标注重试', () => {
    const record = buildProcessIndex([base('n2', { details: { attempts: [{}, {}] } })]).records[0]
    expect(record.recovery.attempts).toBe(2)
    expect(record.recovery.retried).toBe(true)
  })
})

describe('buildProcessSummary 计数口径', () => {
  it('失败按唯一记录计数，受影响父调用按根去重', () => {
    const events: ToolEvent[] = [
      base('root1', { callId: 'root1' }),
      base('c1', { callId: 'c1', status: 'error', stage: 'error', details: { parentCallId: 'root1' } }),
      base('c2', { callId: 'c2', status: 'error', stage: 'error', details: { parentCallId: 'root1' } }),
      base('root2', { callId: 'root2' }),
    ]
    const summary = buildProcessSummary(buildProcessIndex(events))
    expect(summary.failedOperations).toBe(2)
    expect(summary.parentCalls).toBe(2)
    expect(summary.subtasks).toBe(2)
    expect(summary.affectedParentCalls).toBe(1)
  })

  it('阶段更新与生命周期状态分开计数，不相减推算', () => {
    const events: ToolEvent[] = [
      base('one', { callId: 'one', stage: 'start', status: 'running' }),
      base('one', { callId: 'one', stage: 'result', status: 'success' }),
      base('two', { callId: 'two', stage: 'error', status: 'error' }),
      base('three', { callId: 'three', stage: 'start', status: 'running' }),
    ]
    const summary = buildProcessSummary(buildProcessIndex(events))
    // 同 id 合并后 one 只剩最终阶段；阶段直方图按记录数统计，不与状态相减
    expect(summary.totalOperations).toBe(3)
    expect(summary.stages).toEqual({ start: 1, result: 1, error: 1 })
    expect(summary.statuses.success).toBe(1)
    expect(summary.statuses.error).toBe(1)
    expect(summary.statuses.running).toBe(1)
    expect(summary.inFlight).toBe(1)
  })

  it('没有尝试证据时 attempts 为 null 且证据标 unknown', () => {
    const summary = buildProcessSummary(buildProcessIndex([base('one')]))
    expect(summary.attempts).toBeNull()
    expect(summary.attemptsEvidence).toBe('unknown')
  })

  it('摘要文案不含未确证数字', () => {
    const summary = buildProcessSummary(buildProcessIndex([base('one')]))
    expect(summary.summaryText).toBe('父调用 1 次')
  })
})

describe('normalizeProcessCoverage 三态与分别计量', () => {
  it('缺省三层都是 unknown，不伪装完整', () => {
    expect(normalizeProcessCoverage()).toEqual({
      trace: { status: 'unknown' },
      persisted: { status: 'unknown' },
      projection: { status: 'unknown' },
    })
  })

  it('丢记录与截断字段分别计量', () => {
    const coverage = normalizeProcessCoverage({
      trace: { status: 'partial', droppedRecords: 454, truncatedFields: 12 },
      persisted: { status: 'complete' },
    })
    expect(coverage.trace.droppedRecords).toBe(454)
    expect(coverage.trace.truncatedFields).toBe(12)
    expect(coverage.persisted).toEqual({ status: 'complete' })
    expect(coverage.projection).toEqual({ status: 'unknown' })
  })
})
