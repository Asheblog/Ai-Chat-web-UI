import { create } from 'zustand'
import { getAggregatedModels } from '@/features/system/api'

export type ModelItem = {
  id: string
  rawId: string
  name: string
  provider: string
  /** Connection group display name (stable source label). */
  displayName?: string
  channelName: string
  connectionBaseUrl: string
  connectionId: number
  modelType?: 'chat' | 'embedding' | 'both'
  tags?: Array<{ name: string }>
  capabilities?: { vision?: boolean; image_generation?: boolean }
  capabilitySource?: string
  overridden?: boolean
  /** 覆写按字段归属：能力 / 生成参数 / 访问策略各自独立。 */
  overrides?: {
    capability: boolean
    parameters: boolean
    access: boolean
    any: boolean
  }
  /** 该连接协议/方言可下发的思考强度；缺省表示按协议全量。 */
  efforts?: string[]
  /** Requested level to level forwarded by the chat adapter. */
  appliedEfforts?: Partial<Record<string, string>>
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
