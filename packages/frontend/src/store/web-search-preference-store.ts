import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface WebSearchPreferenceState {
  lastSelection: boolean | null
  setLastSelection: (value: boolean) => void
  clear: () => void
}

export const useWebSearchPreferenceStore = create<WebSearchPreferenceState>()(
  persist(
    (set) => ({
      lastSelection: null,
      setLastSelection: (value) => set({ lastSelection: value }),
      clear: () => set({ lastSelection: null }),
    }),
    {
      name: 'web-search-preference',
      version: 1,
    },
  ),
)
