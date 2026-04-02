'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '@/components/ui/use-toast'
import { getBattleRun, listBattleRuns } from '@/features/battle/api'
import type { BattleRunDetail, BattleRunSummary } from '@/types'

export const ACTIVE_SINGLE_RUN_STORAGE_KEY = 'battle:single-model:active-run-id'
export const LAST_VIEWED_SINGLE_RUN_STORAGE_KEY = 'battle:single-model:last-viewed-run-id'

export function useSingleModelBattleHistory() {
  const { toast } = useToast()
  const [history, setHistory] = useState<BattleRunSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoadingRunId, setHistoryLoadingRunId] = useState<number | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const restoredRef = useRef(false)

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await listBattleRuns({ page: 1, limit: 30 })
      if (res?.success && res.data) {
        setHistory(res.data.runs.filter((item) => item.mode === 'single_model_multi_question'))
      }
    } catch (err: any) {
      toast({ title: err?.message || '加载历史记录失败', variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }, [toast])

  const fetchRunDetail = useCallback(async (targetRunId: number, options?: { silent?: boolean }) => {
    try {
      const res = await getBattleRun(targetRunId)
      if (!res?.success || !res.data) {
        if (!options?.silent) {
          toast({ title: res?.error || '加载记录失败', variant: 'destructive' })
        }
        return null
      }
      const detail = res.data as BattleRunDetail
      if (detail.mode !== 'single_model_multi_question') {
        if (!options?.silent) {
          toast({ title: '该记录不属于单模型多问题模式', variant: 'destructive' })
        }
        return null
      }
      return detail
    } catch (err: any) {
      if (!options?.silent) {
        toast({ title: err?.message || '加载记录失败', variant: 'destructive' })
      }
      return null
    }
  }, [toast])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  return {
    history,
    historyLoading,
    historyLoadingRunId,
    setHistoryLoadingRunId,
    historyExpanded,
    setHistoryExpanded,
    restoredRef,
    refreshHistory,
    fetchRunDetail,
  }
}
