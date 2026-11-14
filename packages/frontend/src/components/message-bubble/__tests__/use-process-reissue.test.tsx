import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useProcessCommands } from '../use-process-commands'
const state = vi.hoisted(() => ({ messageMetas: [] as any[], messageBodies: {} as Record<string, { content: string }>, stopStreaming: vi.fn() }))
vi.mock('@/store/chat-store', () => ({ useChatStore: { getState: () => state } }))
vi.mock('@/features/chat/api/process-control', () => ({ requestFinishWithAvailable: vi.fn() }))
vi.mock('@/features/chat/api/streaming', () => ({ respondResearchPlanApproval: vi.fn() }))
afterEach(() => { state.messageMetas = []; state.messageBodies = {}; vi.restoreAllMocks() })
describe('真实研究计划重新发起', () => {
  it('填回目标轮次的原问题，不误用其他会话或后续轮次', () => {
    state.messageMetas = [
      { id: 1, sessionId: 7, role: 'user', createdAt: '2026-11-14T10:00:00Z' },
      { id: 2, sessionId: 7, role: 'assistant', createdAt: '2026-11-14T10:00:01Z' },
      { id: 3, sessionId: 7, role: 'user', createdAt: '2026-11-14T10:00:02Z' },
      { id: 4, sessionId: 8, role: 'user', createdAt: '2026-11-14T09:00:00Z' },
    ]
    state.messageBodies = { '1': { content: '原始研究问题' }, '3': { content: '后续问题' }, '4': { content: '其他会话' } }
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const { result } = renderHook(() => useProcessCommands(7, undefined, 2))
    result.current.onReissuePlan?.({ reason: 'expired', planTitle: '计划标题' })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'aichat:composer-prefill', detail: { content: '原始研究问题' } }))
  })
  it('重生成分支优先使用明确的父问题，不取创建时间前的后续轮次', () => {
    state.messageMetas = [
      { id: 1, sessionId: 7, role: 'user', createdAt: '2026-11-14T10:00:00Z' },
      { id: 3, sessionId: 7, role: 'user', createdAt: '2026-11-14T10:00:02Z' },
      { id: 5, sessionId: 7, role: 'assistant', parentMessageId: 1, createdAt: '2026-11-14T10:00:03Z' },
    ]
    state.messageBodies = { '1': { content: '分支的原问题' }, '3': { content: '后续问题' } }
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const { result } = renderHook(() => useProcessCommands(7, undefined, 5))
    result.current.onReissuePlan?.({ reason: 'expired', planTitle: '计划' })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ detail: { content: '分支的原问题' } }))
  })
  it('原轮次未加载时用计划标题填入，不发送请求或自动生成', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent')
    const { result } = renderHook(() => useProcessCommands(7, undefined, 'not-loaded'))
    result.current.onReissuePlan?.({ reason: 'aborted', planTitle: '可编辑的研究方向' })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ detail: { content: '可编辑的研究方向' } }))
    expect(state.stopStreaming).not.toHaveBeenCalled()
  })
})
