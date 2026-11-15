import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useSessionKnowledgeBaseSync } from '../use-session-knowledge-base-sync'

type PersistImpl = (ids: number[]) => Promise<unknown> | void

interface HarnessProps {
  sessionId: number | null
  sessionKbIds: number[]
  selected: number[]
  persistImpl?: PersistImpl
}

function useHarness({ sessionId, sessionKbIds, selected: initialSelected, persistImpl }: HarnessProps) {
  const [selected, setSelected] = useState(initialSelected)
  // 跨渲染保持同一 mock，调用计数才能跨 act 累加。
  const persistRef = useRef<ReturnType<typeof vi.fn<PersistImpl>> | null>(null)
  if (!persistRef.current) persistRef.current = vi.fn<PersistImpl>(persistImpl ?? (async () => undefined))
  const persist = persistRef.current
  const { markUserEdit } = useSessionKnowledgeBaseSync({
    sessionId,
    sessionKbIds,
    selectedKbIds: selected,
    setSelectedKbIds: setSelected,
    persist,
  })
  return { selected, setSelected, persist, markUserEdit }
}

const renderSync = (props: HarnessProps) => renderHook((p: HarnessProps) => useHarness(p), { initialProps: props })

describe('useSessionKnowledgeBaseSync', () => {
  it('hydrates the local selection from the session record', () => {
    const { result } = renderSync({ sessionId: 9101, sessionKbIds: [1, 2], selected: [] })
    expect(result.current.selected).toEqual([1, 2])
  })

  it('keeps a user edit and writes it back instead of reverting to the stale session value', () => {
    // 回归：曾经水合 effect 先于写回 effect 执行，把用户刚勾选的知识库立即还原成会话旧值。
    const { result } = renderSync({ sessionId: 9101, sessionKbIds: [], selected: [] })

    act(() => {
      result.current.markUserEdit()
      result.current.setSelected([9])
    })

    expect(result.current.selected).toEqual([9])
    expect(result.current.persist).toHaveBeenCalledExactlyOnceWith([9])
  })

  it('still hydrates session changes that the user did not make', () => {
    const { result, rerender } = renderSync({ sessionId: 9101, sessionKbIds: [1], selected: [] })
    expect(result.current.selected).toEqual([1])

    rerender({ sessionId: 9101, sessionKbIds: [5, 6], selected: result.current.selected })
    expect(result.current.selected).toEqual([5, 6])
  })

  it('drops the pending user edit when the session switches', () => {
    const { result, rerender } = renderSync({ sessionId: 9101, sessionKbIds: [], selected: [] })

    act(() => {
      result.current.markUserEdit()
      result.current.setSelected([9])
    })
    expect(result.current.selected).toEqual([9])

    rerender({ sessionId: 9202, sessionKbIds: [3], selected: result.current.selected })
    expect(result.current.selected).toEqual([3])
  })

  it('does not push anything when there is no session yet', () => {
    const { result } = renderSync({ sessionId: null, sessionKbIds: [], selected: [] })

    act(() => {
      result.current.markUserEdit()
      result.current.setSelected([4])
    })

    expect(result.current.selected).toEqual([4])
    expect(result.current.persist).not.toHaveBeenCalled()
  })
})

describe('useSessionKnowledgeBaseSync 异步边界', () => {
  it('快速连续改选：在途期间不并发推送，落定后补写最新值', async () => {
    const resolvers: Array<() => void> = []
    const persistImpl: PersistImpl = () => new Promise<void>((resolve) => { resolvers.push(resolve) })
    const { result } = renderSync({ sessionId: 9101, sessionKbIds: [], selected: [], persistImpl })

    act(() => {
      result.current.markUserEdit()
      result.current.setSelected([9])
    })
    expect(result.current.persist).toHaveBeenCalledTimes(1)

    // 第二次改选发生在第一次写回仍在途时
    act(() => {
      result.current.markUserEdit()
      result.current.setSelected([9, 10])
    })
    expect(result.current.persist).toHaveBeenCalledTimes(1)
    expect(result.current.selected).toEqual([9, 10])

    await act(async () => { resolvers[0]() })

    expect(result.current.persist).toHaveBeenLastCalledWith([9, 10])
    expect(result.current.persist).toHaveBeenCalledTimes(2)
    expect(result.current.selected).toEqual([9, 10])
  })

  it('旧会话的写回落定不会改回新会话的选择', async () => {
    const resolvers: Array<() => void> = []
    const persistImpl: PersistImpl = () => new Promise<void>((resolve) => { resolvers.push(resolve) })
    const { result, rerender } = renderSync({ sessionId: 9101, sessionKbIds: [], selected: [], persistImpl })

    act(() => {
      result.current.markUserEdit()
      result.current.setSelected([9])
    })

    rerender({ sessionId: 9202, sessionKbIds: [3], selected: result.current.selected })
    expect(result.current.selected).toEqual([3])

    await act(async () => { resolvers[0]() })

    // 旧会话的写回落定既不改新会话选择，也不为新会话补写（新会话记录与新选择一致）。
    expect(result.current.selected).toEqual([3])
    expect(result.current.persist).toHaveBeenCalledTimes(1)
    expect(result.current.persist).toHaveBeenLastCalledWith([9])
  })

  it('写回 promise rejection：保留本地选择、不重试风暴、不产生 unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const persistImpl: PersistImpl = () => Promise.reject(new Error('写回失败'))
      const { result } = renderSync({ sessionId: 9101, sessionKbIds: [], selected: [], persistImpl })

      act(() => {
        result.current.markUserEdit()
        result.current.setSelected([9])
      })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

      expect(result.current.selected).toEqual([9])
      expect(result.current.persist).toHaveBeenCalledTimes(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('写回同步 throw：同样按已落定处理，本地保留且只调用一次', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const persistImpl: PersistImpl = () => { throw new Error('同步写回异常') }
      const { result } = renderSync({ sessionId: 9101, sessionKbIds: [], selected: [], persistImpl })

      act(() => {
        result.current.markUserEdit()
        result.current.setSelected([9])
      })
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

      expect(result.current.selected).toEqual([9])
      expect(result.current.persist).toHaveBeenCalledTimes(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
describe('useSessionKnowledgeBaseSync 水合与代次', () => {
  it('本地按有效列表裁剪后不会被会话记录重新水合成旧值', async () => {
    // 回归：水合曾以“本地与会话不一致”为条件，裁剪导致的不一致会触发再次水合并形成渲染循环。
    const setSpy = vi.fn()
    function useHarness({ sessionId, sessionKbIds, selected }: { sessionId: number; sessionKbIds: number[]; selected: number[] }) {
      const [current, setCurrent] = useState(selected)
      const setSelectedKbIds = (ids: number[]) => { setSpy(ids); setCurrent(ids) }
      const { markUserEdit } = useSessionKnowledgeBaseSync({
        sessionId, sessionKbIds, selectedKbIds: current, setSelectedKbIds, persist: async () => undefined,
      })
      return { current, setCurrent, markUserEdit }
    }
    const { result, rerender } = renderHook((p) => useHarness(p), {
      initialProps: { sessionId: 9101, sessionKbIds: [1, 2], selected: [] as number[] },
    })
    expect(result.current.current).toEqual([1, 2])
    setSpy.mockClear()

    // use-knowledge-base 的有效列表裁剪：会话记录仍是 [1,2]，本地变成 [1]
    act(() => { result.current.setCurrent([1]) })
    await act(async () => { await Promise.resolve() })

    expect(setSpy).not.toHaveBeenCalled()
    expect(result.current.current).toEqual([1])

    // 未编辑时的外部变更仍应水合
    rerender({ sessionId: 9101, sessionKbIds: [3], selected: [1] })
    await act(async () => { await Promise.resolve() })
    expect(result.current.current).toEqual([3])
  })

  it('A→B→A 会话切换后，旧写回落定不会清掉当前会话的在途状态', async () => {
    const resolvers: Array<() => void> = []
    const persistImpl: PersistImpl = () => new Promise<void>((resolve) => { resolvers.push(resolve) })
    const { result, rerender } = renderSync({ sessionId: 9101, sessionKbIds: [], selected: [], persistImpl })

    act(() => { result.current.markUserEdit(); result.current.setSelected([9]) })   // A1 在途
    rerender({ sessionId: 9202, sessionKbIds: [3], selected: result.current.selected })
    act(() => { result.current.markUserEdit(); result.current.setSelected([4]) })   // B1 在途
    rerender({ sessionId: 9101, sessionKbIds: [], selected: result.current.selected })
    act(() => { result.current.markUserEdit(); result.current.setSelected([7]) })   // A2 在途

    expect(result.current.persist).toHaveBeenCalledTimes(3)

    // 最早的 A1 落定：它属于上一代，不得清掉 A2 的在途状态
    await act(async () => { resolvers[0]() })
    act(() => { result.current.markUserEdit(); result.current.setSelected([8]) })

    expect(result.current.persist).toHaveBeenCalledTimes(3)
    expect(result.current.selected).toEqual([8])
  })
})