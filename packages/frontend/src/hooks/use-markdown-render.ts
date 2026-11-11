'use client'

import { useEffect, useRef, useState } from 'react'
import {
  requestMarkdownRender,
  subscribeMarkdownWorkerReady,
  type RenderResponse,
} from '@/lib/markdown-worker-client'

interface Snapshot {
  identity: string
  content: string
  version: number
  isStreaming: boolean
}
interface Rendered extends Snapshot {
  html: string | null
  errored: boolean
}
interface Options extends Snapshot {
  enabled?: boolean
  onRendered?: (snapshot: Snapshot, result: RenderResponse) => void
}

const sameSnapshot = (a: Snapshot | null, b: Snapshot) => Boolean(a &&
  a.identity === b.identity && a.content === b.content &&
  a.version === b.version && a.isStreaming === b.isStreaming)
const RECOVERY_COOLDOWN_MS = 10000
const MIN_RECOVERY_DELAY_MS = 1000
const MAX_RECOVERY_ATTEMPTS = 2

/** One job plus one latest snapshot; appending must not cancel in-flight work. */
export function useMarkdownRender(options: Options) {
  const { identity, content, version, isStreaming, enabled = true } = options
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef<Snapshot>({ identity, content, version, isStreaming })
  const attempted = useRef<Snapshot | null>(null)
  const alive = useRef(false)
  const running = useRef(false)
  const generation = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const recoveryTimer = useRef<ReturnType<typeof setTimeout>>()
  const recoveryAttempts = useRef(0)
  const erroredRef = useRef(false)
  const lastStarted = useRef(-Infinity)
  const onRendered = useRef(options.onRendered)
  onRendered.current = options.onRendered
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  const scheduleRef = useRef<() => void>(() => {})

  /** 客户端会给出建议的重试间隔（Worker 冷却/弱网初始化），缺省 10 秒。 */
  const retryDelay = (result?: RenderResponse) => {
    const hint = result?.retryAfterMs
    if (typeof hint !== 'number' || !Number.isFinite(hint)) return RECOVERY_COOLDOWN_MS
    return Math.max(MIN_RECOVERY_DELAY_MS, hint)
  }

  const recover = (snapshot: Snapshot, token: number, delay = RECOVERY_COOLDOWN_MS) => {
    if (!alive.current || !enabledRef.current || token !== generation.current ||
        !sameSnapshot(snapshot, latest.current) || recoveryAttempts.current >= MAX_RECOVERY_ATTEMPTS) return
    recoveryAttempts.current += 1
    clearTimeout(recoveryTimer.current)
    recoveryTimer.current = setTimeout(() => {
      recoveryTimer.current = undefined
      if (!alive.current || token !== generation.current || !sameSnapshot(snapshot, latest.current)) return
      attempted.current = null
      scheduleRef.current()
    }, delay)
  }

  scheduleRef.current = () => {
    if (!alive.current || !enabledRef.current || running.current || timer.current ||
        !latest.current.content || sameSnapshot(attempted.current, latest.current)) return
    const delay = latest.current.isStreaming ? Math.max(0, 280 - (Date.now() - lastStarted.current)) : 0
    timer.current = setTimeout(() => {
      timer.current = undefined
      if (!alive.current || !enabledRef.current || running.current) return
      const snapshot = { ...latest.current }
      const token = generation.current
      attempted.current = snapshot
      running.current = true
      lastStarted.current = Date.now()
      setBusy(true)
      void requestMarkdownRender({
        messageId: snapshot.identity, content: snapshot.content,
        contentVersion: snapshot.version, reasoningVersion: 0, isStreaming: snapshot.isStreaming,
      }).then((result) => {
        if (!alive.current || token !== generation.current) return
        const current = latest.current
        if (snapshot.identity !== current.identity || !current.content.startsWith(snapshot.content)) return
        const valid = !result.errored && result.contentVersion === snapshot.version && typeof result.contentHtml === 'string'
        erroredRef.current = !valid
        setRendered({ ...snapshot, html: valid ? result.contentHtml : null, errored: !valid })
        if (valid) {
          recoveryAttempts.current = 0
          onRendered.current?.(snapshot, result)
        } else recover(snapshot, token, retryDelay(result))
      }).catch(() => {
        if (alive.current && token === generation.current) {
          erroredRef.current = true
          setRendered({ ...snapshot, html: null, errored: true })
          recover(snapshot, token)
        }
      }).finally(() => {
        running.current = false
        if (alive.current) {
          setBusy(false)
          scheduleRef.current()
        }
      })
    }, delay)
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      generation.current += 1
      clearTimeout(timer.current)
      clearTimeout(recoveryTimer.current)
      recoveryTimer.current = undefined
      timer.current = undefined
      attempted.current = null
    }
  }, [])

  // Worker 迟到 ready（弱网下首包可能晚于软超时）：把已经降级成纯文本的快照
  // 重新排队，不需要等固定冷却，也不需要刷新页面。
  useEffect(() => {
    return subscribeMarkdownWorkerReady(() => {
      if (!alive.current || !enabledRef.current || !erroredRef.current) return
      clearTimeout(recoveryTimer.current)
      recoveryTimer.current = undefined
      recoveryAttempts.current = 0
      attempted.current = null
      scheduleRef.current()
    })
  }, [])

  useEffect(() => {
    clearTimeout(recoveryTimer.current)
    recoveryTimer.current = undefined
    const previous = latest.current
    const replaced = previous.identity !== identity || version < previous.version || !content.startsWith(previous.content) ||
      (!previous.isStreaming && content !== previous.content)
    if (replaced) {
      generation.current += 1
      attempted.current = null
      erroredRef.current = false
      lastStarted.current = -Infinity
      recoveryAttempts.current = 0
      setRendered(null)
    }
    latest.current = { identity, content, version, isStreaming }
    if (replaced || !isStreaming || !enabled) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    scheduleRef.current()
  }, [identity, content, version, isStreaming, enabled])

  const usable = rendered?.identity === identity && rendered.version <= version && content.startsWith(rendered.content) &&
    (rendered.isStreaming || rendered.content === content)
  return {
    html: usable ? rendered.html : null,
    source: usable ? rendered.content : '',
    errored: Boolean(usable && rendered.errored),
    isRendering: busy || Boolean(enabled && content && !sameSnapshot(attempted.current, latest.current)),
  }
}
