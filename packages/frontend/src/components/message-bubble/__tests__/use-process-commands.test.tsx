import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessCommandTarget } from '@/features/chat/process-workspace/types'

/**
 * 工作区命令适配层：真实 API / store 用 vi.mock 顶掉，只验证适配层自身的不变量：
 * - 停止后续工具与整轮取消都用调用方 target 精确定位，不改写、不省略目标
 * - 重新生成是整轮操作，不伪装成单次工具重试
 * - 研究计划只转发真实审批通道，失败必须冒泡成可读错误
 */
const mocks = vi.hoisted(() => ({
  stopTools: vi.fn(),
  respondApproval: vi.fn(),
  stopStreaming: vi.fn(),
}))

vi.mock('@/features/chat/api/process-control', () => ({
  requestFinishWithAvailable: mocks.stopTools,
}))
vi.mock('@/features/chat/api/streaming', () => ({
  respondResearchPlanApproval: mocks.respondApproval,
}))
vi.mock('@/store/chat-store', () => ({
  useChatStore: { getState: () => ({ stopStreaming: mocks.stopStreaming }) },
}))

import { useProcessCommands } from '../use-process-commands'

const target = (override: Partial<ProcessCommandTarget> = {}): ProcessCommandTarget => ({
  sessionId: 7,
  messageId: 3022,
  clientMessageId: 'client-3022',
  ...override,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useProcessCommands', () => {
  it('onStopTools 用调用方 target 精确停止，并把回执原样返回', async () => {
    const { result } = renderHook(() => useProcessCommands(7))
    const stopTarget = target()
    mocks.stopTools.mockResolvedValue({ accepted: true })

    await expect(result.current.onStopTools!(stopTarget)).resolves.toEqual({ accepted: true })

    expect(mocks.stopTools).toHaveBeenCalledTimes(1)
    const [sessionId, forwarded] = mocks.stopTools.mock.calls[0]
    expect(sessionId).toBe(7)
    expect(forwarded).toBe(stopTarget)
    expect(mocks.stopStreaming).not.toHaveBeenCalled()
  })

  it('onStopTools 以 target 的会话为准，不用闭包 sessionId 顶替目标', async () => {
    const { result } = renderHook(() => useProcessCommands(7))
    const crossSession = target({ sessionId: 12, messageId: 4242 })
    mocks.stopTools.mockResolvedValue({ accepted: false, reason: '已结束' })

    await expect(result.current.onStopTools!(crossSession)).resolves.toEqual({ accepted: false, reason: '已结束' })

    expect(mocks.stopTools.mock.calls[0][0]).toBe(12)
    expect(mocks.stopTools.mock.calls[0][1]).toBe(crossSession)
  })

  it('onCancelRun 用调用方 target 精确取消，绝不再无参取消整个会话', async () => {
    const { result } = renderHook(() => useProcessCommands(7))
    const first = target({ sessionId: 7, messageId: 3022 })
    const second = target({ sessionId: 9, messageId: 4044, clientMessageId: 'client-4044' })

    await result.current.onCancelRun!(first)
    await result.current.onCancelRun!(second)

    expect(mocks.stopStreaming).toHaveBeenCalledTimes(2)
    expect(mocks.stopStreaming.mock.calls[0][0]).toBe(first)
    expect(mocks.stopStreaming.mock.calls[1][0]).toBe(second)
    expect(mocks.stopStreaming.mock.calls.every((call) => call[0] !== undefined)).toBe(true)
    expect(mocks.stopTools).not.toHaveBeenCalled()
  })

  it('onRegenerate 是整轮操作：只转发整轮回调，不伪装成单次工具重试', async () => {
    const regenerateTurn = vi.fn()
    const { result } = renderHook(() => useProcessCommands(7, regenerateTurn))

    await result.current.onRegenerate!(target())

    expect(regenerateTurn).toHaveBeenCalledTimes(1)
    expect(regenerateTurn.mock.calls[0]).toHaveLength(0)
    expect(mocks.stopTools).not.toHaveBeenCalled()
    expect(mocks.stopStreaming).not.toHaveBeenCalled()
  })

  it('没有整轮回调时不暴露可执行的重生成命令', () => {
    const { result } = renderHook(() => useProcessCommands(7))
    expect(result.current.onRegenerate).toBeUndefined()
  })

  it('研究计划审批成功时 resolve，并把会话、调用与决定交给真实通道', async () => {
    const { result } = renderHook(() => useProcessCommands(7))
    mocks.respondApproval.mockResolvedValue({ data: { success: true } })

    await expect(
      result.current.onResearchPlanDecision!({ callId: 'call-1', decision: 'approve' }),
    ).resolves.toBeUndefined()

    expect(mocks.respondApproval).toHaveBeenCalledTimes(1)
    expect(mocks.respondApproval).toHaveBeenCalledWith(7, 'call-1', 'approve', undefined)
  })

  it('研究计划未被受理时抛出可读错误，不静默成功', async () => {
    const { result } = renderHook(() => useProcessCommands(7))
    mocks.respondApproval.mockResolvedValue({ data: { success: false } })

    await expect(
      result.current.onResearchPlanDecision!({ callId: 'call-1', decision: 'cancel' }),
    ).rejects.toThrow('计划操作未受理，请刷新运行状态')
  })

  it('调整反馈原样透传给审批通道', async () => {
    const { result } = renderHook(() => useProcessCommands(7))
    mocks.respondApproval.mockResolvedValue({ data: { success: true } })

    await result.current.onResearchPlanDecision!({
      callId: 'call-2',
      decision: 'adjust',
      feedback: '请补充成本数据',
    })

    expect(mocks.respondApproval).toHaveBeenCalledWith(7, 'call-2', 'adjust', '请补充成本数据')
  })

  it('同一会话内命令对象引用稳定，避免工作区每次渲染重置控件状态', () => {
    const { result, rerender } = renderHook(({ sessionId }: { sessionId: number }) => useProcessCommands(sessionId), {
      initialProps: { sessionId: 7 },
    })
    const first = result.current

    rerender({ sessionId: 7 })
    expect(result.current).toBe(first)

    rerender({ sessionId: 8 })
    expect(result.current).not.toBe(first)
  })
})
