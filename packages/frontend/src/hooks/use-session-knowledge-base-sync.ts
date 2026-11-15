import { useCallback, useEffect, useRef } from 'react'

const selectionKey = (ids: number[]): string => ids.slice().sort((a, b) => a - b).join(',')

export interface SessionKnowledgeBaseSyncOptions {
  sessionId: number | null
  /** 会话记录里的知识库选择（服务端权威值）。 */
  sessionKbIds: number[]
  /** 输入区当前选择。 */
  selectedKbIds: number[]
  setSelectedKbIds: (ids: number[]) => void
  /** 把用户选择写回会话记录。 */
  persist: (ids: number[]) => Promise<unknown> | void
}

/**
 * 会话知识库选择与会话记录之间的双向同步。
 *
 * 关键约束：
 * 1. 用户主动改选是权威值——先本地生效、再写回会话，水合不得把它覆盖回旧值；
 * 2. 连续快速改选只写回最新值：在途期间不并发推送，落定后若本地又变了再补一次；
 * 3. 写回失败或仍在途时不重试风暴，本地选择保留，等用户下一次改选自然重试；
 * 4. 会话切换后，旧会话的写回落定结果一律忽略（不得把旧选择推给新会话，也不得清掉新会话的在途状态）。
 */
export function useSessionKnowledgeBaseSync({
  sessionId,
  sessionKbIds,
  selectedKbIds,
  setSelectedKbIds,
  persist,
}: SessionKnowledgeBaseSyncOptions) {
  const userEditPendingRef = useRef(false)
  const inFlightRef = useRef(false)
  const pushedKeyRef = useRef<string | null>(null)
  const pushedSessionRef = useRef<number | null>(null)

  const sessionKey = selectionKey(sessionKbIds)
  const selectedKey = selectionKey(selectedKbIds)

  // effect 内读到的永远是最新值，避免闭包快照。
  const latestSelectedRef = useRef(selectedKbIds)
  latestSelectedRef.current = selectedKbIds
  const sessionKeyRef = useRef(sessionKey)
  sessionKeyRef.current = sessionKey
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const persistRef = useRef(persist)
  persistRef.current = persist

  /** 串行写回：在途时不并发，落定后只补一次最新值。 */
  const flush = useCallback(() => {
    if (inFlightRef.current) return
    const target = sessionIdRef.current
    if (target === null) return
    const latest = latestSelectedRef.current
    const latestKey = selectionKey(latest)
    if (latestKey === sessionKeyRef.current) return
    if (pushedKeyRef.current === latestKey) return
    pushedKeyRef.current = latestKey
    pushedSessionRef.current = target
    inFlightRef.current = true
    void Promise.resolve(persistRef.current(latest)).finally(() => {
      // 旧会话的写回落定：既不清新会话的在途标记，也不触发新会话的补写。
      if (pushedSessionRef.current !== sessionIdRef.current) return
      inFlightRef.current = false
      const nextKey = selectionKey(latestSelectedRef.current)
      if (nextKey !== sessionKeyRef.current && nextKey !== pushedKeyRef.current) {
        flush()
      }
    })
  }, [])

  // 会话切换：清掉上一会话的编辑标记与写回状态，允许从新会话记录水合。
  useEffect(() => {
    userEditPendingRef.current = false
    pushedKeyRef.current = null
    inFlightRef.current = false
  }, [sessionId])

  useEffect(() => {
    if (sessionId === null) return
    if (sessionKey === selectedKey) {
      userEditPendingRef.current = false
      return
    }
    if (inFlightRef.current) return
    if (userEditPendingRef.current) return
    setSelectedKbIds(sessionKbIds)
  }, [sessionId, sessionKbIds, sessionKey, selectedKey, setSelectedKbIds])

  useEffect(() => {
    if (sessionId === null) return
    if (sessionKey === selectedKey) {
      pushedKeyRef.current = null
      return
    }
    if (!userEditPendingRef.current) return
    flush()
  }, [flush, selectedKbIds, selectedKey, sessionId, sessionKey])

  /** 用户主动改选前调用：把本地选择标记为权威值，直到会话记录追上。 */
  const markUserEdit = useCallback(() => {
    userEditPendingRef.current = true
  }, [])

  return { markUserEdit }
}
