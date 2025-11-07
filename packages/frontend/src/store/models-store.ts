import { create } from 'zustand'
import { apiClient } from '@/lib/api'

export type ModelItem = {
  id: string
  rawId: string
  name: string
  provider: string
  channelName: string
  connectionBaseUrl: string
  connectionId: number
  connectionType?: string
  tags?: Array<{ name: string }>
  capabilities?: { vision?: boolean; file_upload?: boolean; web_search?: boolean; image_generation?: boolean; code_interpreter?: boolean }
  capabilitySource?: string
  overridden?: boolean
  contextWindow?: number | null
}

interface ModelsStoreState {
  models: ModelItem[]
  isLoading: boolean
  error: string | null
  fetchAll: () => Promise<void>
  setOne: (item: ModelItem) => void
}

export const useModelsStore = create<ModelsStoreState>((set, get) => ({
  models: [],
  isLoading: false,
  error: null,
  fetchAll: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await apiClient.getAggregatedModels()
      set({ models: res?.data || [], isLoading: false })
    } catch (e: any) {
      set({ error: e?.message || '加载模型失败', isLoading: false })
    }
  },
  setOne: (item) => {
    set((state) => ({ models: state.models.map(m => (m.connectionId === item.connectionId && m.id === item.id) ? item : m) }))
  }
}))
