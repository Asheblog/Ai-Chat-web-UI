import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ReasoningEffortSelection } from '@/types/chat'

interface ReasoningEffortPreferenceState {
  lastSelection: ReasoningEffortSelection | null
  setLastSelection: (value: ReasoningEffortSelection) => void
  clear: () => void
}

export const useReasoningEffortPreferenceStore = create<ReasoningEffortPreferenceState>()(
  persist(
    (set) => ({
      lastSelection: null,
      setLastSelection: (value) => set({ lastSelection: value }),
      clear: () => set({ lastSelection: null }),
    }),
    { name: 'reasoning-effort-preference', partialize: (state) => ({ lastSelection: state.lastSelection }) },
  ),
)
