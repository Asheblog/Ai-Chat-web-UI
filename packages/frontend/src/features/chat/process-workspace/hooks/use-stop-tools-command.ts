'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { extractErrorMessage } from '@/lib/utils'
import type { ProcessCommandTarget, StopToolsCommandResult, ProcessWorkspaceCommands } from '../types'

export type StopToolsPhase = 'idle' | 'pending' | 'accepted' | 'error'

export interface StopToolsState {
  phase: StopToolsPhase
  error: string | null
  run: () => void
}

/**
 * 停止后续工具：accepted 只表示后端已受理，工具状态一律等运行事件反馈。
 * 出错保留错误文案并可重试；重试只重发 stop，不是单次工具重试。
 */
export function useStopToolsCommand({
  enabled,
  target,
  onStopTools,
}: {
  enabled: boolean
  target: ProcessCommandTarget
  onStopTools?: ProcessWorkspaceCommands['onStopTools']
}): StopToolsState {
  const [phase, setPhase] = useState<StopToolsPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const targetKey = `${target.sessionId}:${String(target.messageId)}:${target.clientMessageId ?? ''}`

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    setPhase('idle')
    setError(null)
  }, [targetKey])

  const run = useCallback(() => {
    if (!enabled || !onStopTools) return
    setPhase('pending')
    setError(null)
    Promise.resolve()
      .then(() => onStopTools(target))
      .then((result: StopToolsCommandResult) => {
        if (!alive.current) return
        if (result && result.accepted === false) {
          setPhase('error')
          setError(result.reason?.trim() || '请求未被受理，请以当前运行状态为准')
          return
        }
        setPhase('accepted')
      })
      .catch((err: unknown) => {
        if (!alive.current) return
        setPhase('error')
        setError(extractErrorMessage(err))
      })
  }, [enabled, onStopTools, target])

  return useMemo(() => ({ phase, error, run }), [phase, error, run])
}
