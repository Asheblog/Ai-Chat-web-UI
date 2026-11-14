import {
  buildToolOperationIndex,
  buildToolOperationSummary,
} from '@aichat/shared/tool-operations'
import type { ToolEvent } from '@aichat/shared/tool-operations'
import { resolveEventStatus } from '@aichat/shared/tool-events'
import { childOf, event, parentCall } from './tool-operations-fixtures'

describe('ToolOperationIndex 身份与父子关系', () => {
  test('父调用的唯一 callId 连接子记录，且子记录不被并入父记录', () => {
    const index = buildToolOperationIndex([
      parentCall('call-p'),
      childOf('call-p', 'call-p:search:initial:1', { createdAt: 11 }),
      childOf('call-p', 'call-p:read:1', { createdAt: 12 }),
    ])
    const byId = new Map(index.records.map((record) => [record.id, record]))

    expect(index.records).toHaveLength(3)
    expect(index.roots).toEqual(['call-p'])
    expect(index.children['call-p']).toEqual(['call-p:search:initial:1', 'call-p:read:1'])
    expect(byId.get('call-p')?.relation).toBe('root')
    expect(byId.get('call-p:read:1')?.relation).toBe('child')
    expect(byId.get('call-p:read:1')?.parentId).toBe('call-p')
    expect(byId.get('call-p:read:1')?.parentCallId).toBe('call-p')
    expect(index.orphans).toEqual([])
    expect(index.ambiguous).toEqual([])

    const summary = buildToolOperationSummary(index)
    expect(summary.totalOperations).toBe(3)
    expect(summary.parentCalls).toBe(1)
    expect(summary.subtasks).toBe(2)
    expect(summary.orphans).toBe(0)
    expect(summary.ambiguous).toBe(0)
  })

  test('无匹配父候选的 parentCallId 记为 orphan，不虚构父节点', () => {
    const index = buildToolOperationIndex([
      childOf('call-missing', 'call-missing:read:1'),
    ])
    expect(index.records).toHaveLength(1)
    expect(index.records[0].relation).toBe('orphan')
    expect(index.records[0].parentId).toBeNull()
    expect(index.orphans).toEqual(['call-missing:read:1'])
    expect(index.children['call-missing:read:1']).toEqual([])
    expect(index.roots).toEqual([])

    const summary = buildToolOperationSummary(index)
    expect(summary.parentCalls).toBe(0)
    expect(summary.subtasks).toBe(0)
    expect(summary.orphans).toBe(1)
    expect(summary.totalOperations).toBe(1)
  })

  test('同一 callId 命中多个父候选时记为 ambiguous，不归入任一 children', () => {
    const index = buildToolOperationIndex([
      parentCall('dup-a', { callId: 'shared-call' }),
      parentCall('dup-b', { callId: 'shared-call', createdAt: 20 }),
      childOf('shared-call', 'shared-call:read:1'),
    ])
    const child = index.records.find((record) => record.id === 'shared-call:read:1')
    expect(child?.relation).toBe('ambiguous')
    expect(child?.parentId).toBeNull()
    expect(index.ambiguous).toEqual(['shared-call:read:1'])
    expect(index.ambiguousParents['shared-call']).toEqual(['dup-a', 'dup-b'])
    expect(Object.values(index.children).flat()).toEqual([])
    expect(index.roots).toEqual(['dup-a', 'dup-b'])

    const summary = buildToolOperationSummary(index)
    expect(summary.ambiguous).toBe(1)
    expect(summary.subtasks).toBe(0)
    expect(summary.parentCalls).toBe(2)
  })

  test('多个候选时优先连接无 parent 声明的真实父候选', () => {
    const index = buildToolOperationIndex([
      parentCall('outer', { callId: 'outer' }),
      childOf('outer', 'nested', { callId: 'shared-call', createdAt: 11 }),
      parentCall('real-parent', { callId: 'shared-call', createdAt: 12 }),
      childOf('shared-call', 'shared-call:read:1', { createdAt: 13 }),
    ])
    const child = index.records.find((record) => record.id === 'shared-call:read:1')
    expect(child?.relation).toBe('child')
    expect(child?.parentId).toBe('real-parent')
    expect(index.children['real-parent']).toEqual(['shared-call:read:1'])
    expect(index.children['nested']).toEqual([])
    expect(index.ambiguous).toEqual([])
  })

  test('唯一候选即使自身也声明了 parent 仍然连接（父子链）', () => {
    const index = buildToolOperationIndex([
      parentCall('root-call'),
      childOf('root-call', 'mid-call', { callId: 'mid-call', createdAt: 11 }),
      childOf('mid-call', 'mid-call:read:1', { createdAt: 12 }),
    ])
    const mid = index.records.find((record) => record.id === 'mid-call')
    expect(mid?.relation).toBe('child')
    expect(mid?.parentId).toBe('root-call')
    expect(index.children['mid-call']).toEqual(['mid-call:read:1'])

    const summary = buildToolOperationSummary(index)
    expect(summary.parentCalls).toBe(1)
    expect(summary.subtasks).toBe(2)
  })

  test('不同 id 不会因为共享 callId 而被合并', () => {
    const index = buildToolOperationIndex([
      parentCall('dup-a', { callId: 'shared-call' }),
      parentCall('dup-b', { callId: 'shared-call', createdAt: 20 }),
    ])
    expect(index.records.map((record) => record.id)).toEqual(['dup-a', 'dup-b'])
    expect(index.records.map((record) => record.operationId)).toEqual(['dup-a', 'dup-b'])
    expect(index.duplicateCount).toBe(0)
  })

  test('父子环被降级为 ambiguous，避免无限父链', () => {
    const index = buildToolOperationIndex([
      event({ id: 'a', callId: 'a', tool: 'web_search', details: { parentCallId: 'b' } }),
      event({ id: 'b', callId: 'b', tool: 'web_search', details: { parentCallId: 'a' }, createdAt: 2 }),
    ])
    expect(index.ambiguous).toEqual(['a', 'b'])
    expect(Object.values(index.children).flat()).toEqual([])
    expect(index.records.every((record) => record.parentId === null)).toBe(true)
  })
})


describe('匿名 callId 与显式 id 命名空间', () => {
  test('显式 id "call:abc" 不与匿名 callId "abc" 合并，两条记录 id 不同', () => {
    const explicit = event({
      id: 'call:abc',
      callId: 'abc',
      tool: 'web_search',
      stage: 'result',
      status: 'success',
      createdAt: 1,
    })
    const anonymous = {
      sessionId: 1,
      messageId: 1,
      tool: 'web_search',
      stage: 'start',
      status: 'running',
      callId: 'abc',
      createdAt: 2,
    } as unknown as ToolEvent

    const index = buildToolOperationIndex([explicit, anonymous])
    expect(index.records).toHaveLength(2)
    const ids = index.records.map((record) => record.id)
    expect(ids).toContain('call:abc')
    expect(ids).toContain('call:abc#2')
    expect(new Set(ids).size).toBe(2)
    expect(index.duplicateCount).toBe(0)
  })

  test('真实 id 恰好等于匿名命名空间形态时也不碰撞（外部 id 无字符串约束）', () => {
    const explicit = event({
      id: 'anon-call:abc',
      callId: 'anon-call:abc',
      tool: 'web_search',
      stage: 'result',
      status: 'success',
      createdAt: 1,
    })
    const anonymous = {
      sessionId: 1,
      messageId: 1,
      tool: 'web_search',
      stage: 'start',
      status: 'running',
      callId: 'abc',
      createdAt: 2,
    } as unknown as ToolEvent

    const index = buildToolOperationIndex([explicit, anonymous])
    expect(index.records).toHaveLength(2)
    const ids = index.records.map((record) => record.id)
    expect(ids).toContain('anon-call:abc')
    // 匿名记录保留兼容形态，遇到真实 id 占用时自动消歧
    expect(ids).toContain('call:abc')
    expect(new Set(ids).size).toBe(2)
  })

  test('同一 Anonymous callId 的多条无 id 副本仍合并为一条', () => {
    const base = {
      sessionId: 1,
      messageId: 1,
      tool: 'web_search',
      callId: 'only-call',
      createdAt: 5,
    }
    const first = { ...base, stage: 'start', status: 'running' } as unknown as ToolEvent
    const second = { ...base, stage: 'result', status: 'success', updatedAt: 6 } as unknown as ToolEvent
    const index = buildToolOperationIndex([first, second])
    expect(index.records).toHaveLength(1)
    expect(index.duplicateCount).toBe(1)
    expect(index.records[0].id).toBe('call:only-call')
    expect(index.records[0].status).toBe('success')
  })
})


describe('resolveEventStatus 结构类型（T1 单一实现）', () => {
  test('旧 ToolLogEntry 形态（无 session 字段、phase 宽松 string、status 可选）可直接调用', () => {
    type LegacyEntry = {
      status?: 'running' | 'success' | 'error' | 'pending' | 'rejected' | 'aborted'
      phase?: string
      stage: 'start' | 'result' | 'error'
    }
    const pendingApproval: LegacyEntry = { phase: 'pending_approval', stage: 'start' }
    const abortedPhase: LegacyEntry = { phase: 'aborted', stage: 'error' }
    const explicit: LegacyEntry = { status: 'rejected', phase: 'executing', stage: 'start' }
    const startOnly: LegacyEntry = { stage: 'start' }

    expect(resolveEventStatus(pendingApproval)).toBe('pending')
    expect(resolveEventStatus(abortedPhase)).toBe('aborted')
    expect(resolveEventStatus(explicit)).toBe('rejected')
    expect(resolveEventStatus(startOnly)).toBe('running')
  })
});
