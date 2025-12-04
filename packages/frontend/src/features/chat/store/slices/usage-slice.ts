import { apiClient } from '@/lib/api'
import type { UsageSlice } from '../types'
import type { ChatSliceCreator } from '../types'

export const createUsageSlice: ChatSliceCreator<
  UsageSlice & {
    usageCurrent: import('@/types').UsageStats | null
    usageLastRound: import('@/types').UsageStats | null
    usageTotals: import('@/types').UsageTotals | null
    sessionUsageTotalsMap: Record<number, import('@/types').UsageTotals>
  }
> = (set) => ({
  usageCurrent: null,
  usageLastRound: null,
  usageTotals: null,
  sessionUsageTotalsMap: {},

  fetchSessionsUsage: async () => {
    try {
      const res = await apiClient.getSessionsUsage()
      const arr = res.data as Array<{ sessionId: number; totals: import('@/types').UsageTotals }>
      const map: Record<number, import('@/types').UsageTotals> = {}
      ;(arr || []).forEach((item) => {
        map[item.sessionId] = item.totals
      })
      set({ sessionUsageTotalsMap: map })
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[fetchSessionsUsage] error', (error as any)?.message || error)
      }
    }
  },

  fetchUsage: async (sessionId: number) => {
    try {
      const res = await apiClient.getUsage(sessionId)
      const data = res.data || {}
      set({
        usageTotals: data.totals || null,
        usageLastRound: data.last_round || null,
        usageCurrent: data.current || null,
      })
    } catch (error: any) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[fetchUsage] error', error?.message || error)
      }
    }
  },
})
