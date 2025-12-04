import type { ShareSlice } from '../types'
import type { ChatSliceCreator } from '../types'
import { createInitialShareSelection } from '../utils'

export const createShareSlice: ChatSliceCreator<
  ShareSlice & { shareSelection: ReturnType<typeof createInitialShareSelection> }
> = (set) => ({
  shareSelection: createInitialShareSelection(),

  enterShareSelectionMode: (sessionId: number, messageId?: number) => {
    if (!Number.isFinite(sessionId)) return
    set((state) => {
      const keepExisting = state.shareSelection.enabled && state.shareSelection.sessionId === sessionId
      const nextIds = keepExisting ? [...state.shareSelection.selectedMessageIds] : []
      if (typeof messageId === 'number' && Number.isFinite(messageId) && !nextIds.includes(messageId)) {
        nextIds.push(messageId)
      }
      return {
        shareSelection: {
          enabled: true,
          sessionId,
          selectedMessageIds: nextIds,
        },
      }
    })
  },

  toggleShareSelection: (sessionId: number, messageId: number) => {
    if (!Number.isFinite(sessionId) || !Number.isFinite(messageId)) return
    set((state) => {
      if (!state.shareSelection.enabled || state.shareSelection.sessionId !== sessionId) {
        return {}
      }
      const exists = state.shareSelection.selectedMessageIds.includes(messageId)
      const nextIds = exists
        ? state.shareSelection.selectedMessageIds.filter((id) => id !== messageId)
        : [...state.shareSelection.selectedMessageIds, messageId]
      return {
        shareSelection: {
          ...state.shareSelection,
          selectedMessageIds: nextIds,
        },
      }
    })
  },

  clearShareSelection: () => {
    set((state) => {
      if (!state.shareSelection.enabled || state.shareSelection.selectedMessageIds.length === 0) {
        return {}
      }
      return {
        shareSelection: {
          ...state.shareSelection,
          selectedMessageIds: [],
        },
      }
    })
  },

  exitShareSelectionMode: () => {
    set({ shareSelection: createInitialShareSelection() })
  },
})
