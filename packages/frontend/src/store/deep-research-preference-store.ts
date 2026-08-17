import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface DeepResearchPreferenceState {
  lastSelection: boolean | null
  setLastSelection: (value: boolean) => void
  clear: () => void
}

export const useDeepResearchPreferenceStore = create<DeepResearchPreferenceState>()(
  persist(
    (set) => ({
      lastSelection: null,
      setLastSelection: (value) => set({ lastSelection: value }),
      clear: () => set({ lastSelection: null }),
    }),
    {
      name: 'deep-research-preference',
      version: 1,
    },
  ),
)
