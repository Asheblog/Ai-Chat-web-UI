import { create } from "zustand"
import { persist } from "zustand/middleware"

interface PythonToolPreferenceState {
  lastSelection: boolean | null
  setLastSelection: (value: boolean) => void
  clear: () => void
}

export const usePythonToolPreferenceStore = create<PythonToolPreferenceState>()(
  persist(
    (set) => ({
      lastSelection: null,
      setLastSelection: (value) => set({ lastSelection: value }),
      clear: () => set({ lastSelection: null }),
    }),
    {
      name: "python-tool-preference",
      version: 1,
    },
  ),
)
