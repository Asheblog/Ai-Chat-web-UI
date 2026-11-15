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
 * 2. 水合只在“会话记录身份变化”时执行（§sessionId:ids§ 变化）：本地按有效列表裁剪造成的不一致
 *    不会被再次水合，既避免渲染循环，也保留未编辑时的外部变更水合；
 * 3. 连续快速改选只写回最新值：在途期间不并发推送，落定后若本地又变了再补一次；
 * 4. 每次推送带一个自增代次，落定只认自己那一代——A→B→A 或更晚的推送已接管时一律忽略，
 *    不会清掉当前会话的在途标记；
 * 5. 写回失败或仍在途时不重试风暴，本地选择保留，等用户下一次改选自然重试。
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
  const pushGenerationRef = useRef(0)
  const hydratedKeyRef = useRef<string | null>(null)

  const sessionKey = selectionKey(sessionKbIds)
  const selectedKey = selectionKey(selectedKbIds)

  // effect 与落定回调读到的永远是最新值，避免闭包快照。
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
    if (sessionIdRef.current === null) return
    const latest = latestSelectedRef.current
    const latestKey = selectionKey(latest)
    if (latestKey === sessionKeyRef.current) return
    if (pushedKeyRef.current === latestKey) return

    pushGenerationRef.current += 1
    const generation = pushGenerationRef.current
    pushedKeyRef.current = latestKey
    inFlightRef.current = true
    const settle = () => {
      // 只认这一次推送的代次：更晚的推送（含 A→B→A 回到同一会话）已经接管，直接返回。
      if (generation !== pushGenerationRef.current) return
      inFlightRef.current = false
      const nextKey = selectionKey(latestSelectedRef.current)
      if (nextKey !== sessionKeyRef.current && nextKey !== pushedKeyRef.current) {
        flush()
      }
    }
    // persist 保持同步调用（写回时机不变），但两种失败都按“已落定”处理：
    // 同步 throw 直接 settle；异步 rejection 走 then 的第二个回调，不再抛到链尾造成 unhandled rejection。
    let pending: Promise<unknown> | void
    try {
      pending = persistRef.current(latest)
    } catch {
      settle()
      return
    }
    void Promise.resolve(pending).then(settle, settle)
  }, [])

  // 会话切换：作废上一会话的在途写回、清掉编辑标记与水合记忆，允许从新会话记录水合。
  useEffect(() => {
    userEditPendingRef.current = false
    pushedKeyRef.current = null
    inFlightRef.current = false
    hydratedKeyRef.current = null
    pushGenerationRef.current += 1
  }, [sessionId])

  // 水合：只看“会话记录身份”是否变过。本地裁剪（会话记录没变）不会触发再次水合。
  useEffect(() => {
    if (sessionId === null) return
    const hydrationKey = sessionId + ':' + sessionKey
    if (hydratedKeyRef.current === hydrationKey) return
    if (inFlightRef.current) return
    if (userEditPendingRef.current && sessionKey !== selectedKey) return
    hydratedKeyRef.current = hydrationKey
    if (sessionKey === selectedKey) {
      userEditPendingRef.current = false
      return
    }
    setSelectedKbIds(sessionKbIds)
  }, [sessionId, sessionKbIds, sessionKey, selectedKey, setSelectedKbIds])

  // 写回：只推送用户编辑造成的最新值。
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