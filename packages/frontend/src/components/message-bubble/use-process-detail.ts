'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getMessageByClientId, getMessageProgress } from '@/features/chat/api/messages'
import type { MessageMeta, Message } from '@/types'

interface DetailState { key: string; message?: Message; error?: string; loading: boolean }

/** Fetch the full history projection only on demand, scoped to the selected turn. */
export function useProcessDetail(meta: MessageMeta, enabled: boolean) {
  const key = String(meta.sessionId) + ':' + String(meta.id) + ':' + (meta.clientMessageId ?? '')
  const current = useRef(key)
  current.current = key
  const mounted = useRef(true)
  const requested = useRef<string | null>(null)
  const [state, setState] = useState<DetailState>({ key, loading: false })
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const load = useCallback(async () => {
    if (!enabled || meta.sessionId <= 0 || requested.current === key) return
    requested.current = key
    setState({ key, loading: true })
    try {
      const id = Number(meta.id)
      const response = Number.isInteger(id) && id > 0
        ? await getMessageProgress(meta.sessionId, id)
        : meta.clientMessageId
          ? await getMessageByClientId(meta.sessionId, meta.clientMessageId)
          : undefined
      const message = response?.data?.message
      if (!response?.success || !message) throw new Error('详情读取未完成，请重试')
      if (mounted.current && current.current === key) setState({ key, loading: false, message })
    } catch (error) {
      if (mounted.current && current.current === key) {
        setState({ key, loading: false, error: error instanceof Error ? error.message : '详情读取失败，请重试' })
      }
      if (requested.current === key) requested.current = null
    }
  }, [enabled, key, meta.sessionId, meta.id, meta.clientMessageId])
  return { load, message: state.key === key ? state.message : undefined,
    error: state.key === key ? state.error : undefined, loading: state.key === key && state.loading }
}
