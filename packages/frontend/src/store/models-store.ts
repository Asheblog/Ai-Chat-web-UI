import { create } from 'zustand'
import { getAggregatedModels } from '@/features/system/api'

export type ModelItem = {
  id: string
  rawId: string
  name: string
  provider: string
  channelName: string
  connectionBaseUrl: string
  connectionId: number
  connectionType?: string
  modelType?: 'chat' | 'embedding' | 'both'
  tags?: Array<{ name: string }>
  capabilities?: { vision?: boolean; file_upload?: boolean; web_search?: boolean; image_generation?: boolean; code_interpreter?: boolean }
  capabilitySource?: string
  overridden?: boolean
  contextWindow?: number | null
  maxOutputTokens?: number | null
  temperature?: number | null
  accessPolicy?: { anonymous?: 'allow' | 'deny' | 'inherit'; user?: 'allow' | 'deny' | 'inherit' }
  resolvedAccess?: {
    anonymous: { decision: 'allow' | 'deny'; source: 'default' | 'override' }
    user: { decision: 'allow' | 'deny'; source: 'default' | 'override' }
  }
  accessDecision?: 'allow' | 'deny'
}

interface ModelsStoreState {
  models: ModelItem[]
  isLoading: boolean
  error: string | null
  fetchAll: () => Promise<void>
  setOne: (item: ModelItem) => void
}

export const useModelsStore = create<ModelsStoreState>((set) => {
  let fetchAllInFlight: Promise<void> | null = null

  return {
    models: [],
    isLoading: false,
    error: null,
    fetchAll: async () => {
      if (fetchAllInFlight) return fetchAllInFlight
      set({ isLoading: true, error: null })
      fetchAllInFlight = (async () => {
        try {
          const res = await getAggregatedModels()
          set({ models: res?.data || [], isLoading: false })
        } catch (e: any) {
          set({ error: e?.message || '加载模型失败', isLoading: false })
        } finally {
          fetchAllInFlight = null
        }
      })()
      return fetchAllInFlight
    },
    setOne: (item) => {
      set((state) => ({
        models: state.models.map((m) => (
          m.connectionId === item.connectionId && m.id === item.id ? item : m
        )),
      }))
    },
  }
})
