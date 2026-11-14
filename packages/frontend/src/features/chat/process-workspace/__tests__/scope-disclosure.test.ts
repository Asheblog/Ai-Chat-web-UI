import { beforeEach, describe, expect, it } from 'vitest'
import {
  describeRunTerminal,
  formatByteSize,
  formatClockTime,
  formatProcessDuration,
  resolveProcessScope,
  resolveProcessScopeKey,
  resolveRunTerminal,
} from '../model/scope'
import {
  COT_TIMELINE_LEVEL_STORAGE_PREFIX,
  REASONING_VISIBILITY_STORAGE_KEY,
  isLevelOpen,
  persistProcessLevel,
  persistProcessVisibility,
  readProcessLevel,
  readProcessVisibility,
  reasoningItemKey,
  toolItemKey,
} from '../model/disclosure'
import type { MessageMeta } from '@/types'

const meta = (override: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 42,
  sessionId: 7,
  stableKey: 'stable-42',
  role: 'assistant',
  createdAt: '2026-11-14T00:00:00Z',
  ...override,
})

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('resolveProcessScopeKey 与旧 key 顺序一致', () => {
  it('优先 stableKey，其次 String(id)，最后 clientMessageId', () => {
    expect(resolveProcessScopeKey(meta())).toBe('stable-42')
    expect(resolveProcessScopeKey(meta({ stableKey: '' }))).toBe('42')
    expect(resolveProcessScopeKey(meta({ stableKey: '', id: '' , clientMessageId: 'client-9' }))).toBe('client-9')
  })

  it('id 为数字时转成字符串，且不因 clientMessageId 改变顺序', () => {
    expect(resolveProcessScopeKey({ stableKey: '', id: 12, clientMessageId: 'client-12' })).toBe('12')
  })
})

describe('resolveProcessScope 命令能力', () => {
  it('普通聊天可派发命令', () => {
    const scope = resolveProcessScope(meta())
    expect(scope.origin).toBe('chat')
    expect(scope.canCommand).toBe(true)
    expect(scope.target).toEqual({ sessionId: 7, messageId: 42, clientMessageId: null })
  })

  it('只读（分享）不可派发命令', () => {
    const scope = resolveProcessScope(meta(), { readOnly: true })
    expect(scope.origin).toBe('share')
    expect(scope.readOnly).toBe(true)
    expect(scope.canCommand).toBe(false)
  })

  it('Battle 的 sessionId 0 即使没传 readOnly 也不可发 chat 命令', () => {
    const scope = resolveProcessScope(meta({ sessionId: 0 }))
    expect(scope.origin).toBe('battle')
    expect(scope.readOnly).toBe(true)
    expect(scope.canCommand).toBe(false)
  })
})

describe('resolveRunTerminal 读取顺序', () => {
  it('显式 prop 优先', () => {
    const terminal = resolveRunTerminal(meta(), { stopReason: 'stop_tools', finalAnswerGenerated: false })
    expect(terminal).toEqual({ stopReason: 'stop_tools', finalAnswerGenerated: false })
  })

  it('从 metadata.runResult 读 envelope 终态', () => {
    const terminal = resolveRunTerminal(
      meta({ metadata: { runResult: { stopReason: 'budget_exhausted', finalAnswerGenerated: true } } }),
    )
    expect(terminal).toEqual({ stopReason: 'budget_exhausted', finalAnswerGenerated: true })
  })

  it('历史 / share 的扁平同名字段也读', () => {
    const terminal = resolveRunTerminal(
      meta({ stopReason: 'stop_tools', finalAnswerGenerated: false } as Partial<MessageMeta>),
    )
    expect(terminal).toEqual({ stopReason: 'stop_tools', finalAnswerGenerated: false })
  })

  it('缺失字段保持未知，不默认成已生成', () => {
    expect(resolveRunTerminal(meta())).toEqual({})
  })

  it('非法的 stopReason 被忽略', () => {
    const terminal = resolveRunTerminal(meta(), { stopReason: 'whatever' as never })
    expect(terminal.stopReason).toBeUndefined()
  })
})

describe('describeRunTerminal 文案', () => {
  it('finalAnswerGenerated false 显示未生成最终回答并给 warning', () => {
    const view = describeRunTerminal({ finalAnswerGenerated: false })
    expect(view.finalAnswerMissing).toBe(true)
    expect(view.note).toBe('未生成最终回答')
    expect(view.tone).toBe('warning')
  })

  it('停止工具后仍有答案时说明停止原因', () => {
    expect(describeRunTerminal({ stopReason: 'stop_tools', finalAnswerGenerated: true }).note).toBe(
      '已停止后续工具，用已有资料作答',
    )
  })

  it('预算耗尽单独说明', () => {
    expect(describeRunTerminal({ stopReason: 'budget_exhausted' }).note).toBe('工具预算耗尽后收尾')
  })

  it('没有终态信息时不加说明', () => {
    const view = describeRunTerminal({})
    expect(view.note).toBeNull()
    expect(view.tone).toBe('neutral')
  })
})

describe('格式化', () => {
  it('耗时只在正数时显示，分钟按旧格式', () => {
    expect(formatProcessDuration(null)).toBeNull()
    expect(formatProcessDuration(0)).toBeNull()
    expect(formatProcessDuration(45)).toBe('45 秒')
    expect(formatProcessDuration(87)).toBe('1 分 27 秒')
    expect(formatProcessDuration(236)).toBe('3 分 56 秒')
  })

  it('时间缺失返回空串，不写 00:00:00', () => {
    expect(formatClockTime(undefined)).toBe('')
    expect(formatClockTime(0)).toBe('')
    expect(formatClockTime(new Date(2026, 10, 14, 9, 5, 7).getTime())).toBe('09:05:07')
  })

  it('字节大小缺失返回 null', () => {
    expect(formatByteSize(undefined)).toBeNull()
    expect(formatByteSize(900)).toBe('900 B')
    expect(formatByteSize(2048)).toBe('2.0 KB')
  })
})

describe('披露偏好 key 语义保留', () => {
  it('级别按旧 key 前缀存，outline/expanded 视为打开', () => {
    persistProcessLevel('stable-42', 'outline')
    const raw = sessionStorage.getItem(COT_TIMELINE_LEVEL_STORAGE_PREFIX + ':stable-42')
    expect(raw && JSON.parse(raw).level).toBe('outline')
    expect(readProcessLevel('stable-42')).toBe('outline')
    expect(isLevelOpen('outline')).toBe(true)
    expect(isLevelOpen('expanded')).toBe(true)
    expect(isLevelOpen('collapsed')).toBe(false)
  })

  it('损坏的级别记录当没选过', () => {
    sessionStorage.setItem(COT_TIMELINE_LEVEL_STORAGE_PREFIX + ':broken', '{oops')
    expect(readProcessLevel('broken')).toBeNull()
    sessionStorage.setItem(COT_TIMELINE_LEVEL_STORAGE_PREFIX + ':odd', JSON.stringify({ level: 'weird' }))
    expect(readProcessLevel('odd')).toBeNull()
  })

  it('可见性 itemKey 格式与旧实现一致', () => {
    persistProcessVisibility(REASONING_VISIBILITY_STORAGE_KEY, reasoningItemKey('stable-42', 12), true)
    expect(readProcessVisibility(REASONING_VISIBILITY_STORAGE_KEY, 'stable-42:reasoning:12')).toBe(true)
    expect(toolItemKey('stable-42', 'call-1')).toBe('stable-42:tool:call-1')
    expect(readProcessVisibility(REASONING_VISIBILITY_STORAGE_KEY, 'stable-42:reasoning:99')).toBeNull()
  })

  it('旧版本写下的可见性记录仍然生效', () => {
    localStorage.setItem(
      REASONING_VISIBILITY_STORAGE_KEY,
      JSON.stringify({ 'stable-42:reasoning:3': { expanded: true, updatedAt: 1 } }),
    )
    expect(readProcessVisibility(REASONING_VISIBILITY_STORAGE_KEY, 'stable-42:reasoning:3')).toBe(true)
  })
})
