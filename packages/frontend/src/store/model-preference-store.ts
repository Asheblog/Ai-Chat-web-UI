import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ModelPreferenceDTO } from '@/types'
import type { ModelItem } from '@/store/models-store'
import { apiClient } from '@/lib/api'

export interface PreferredModelState {
  modelId: string
  connectionId: number | null
  rawId: string | null
}

interface ModelPreferenceStore {
  preferred: PreferredModelState | null
  lastPersistError: string | null
  setLocalPreference: (pref: PreferredModelState | null) => void
  hydrateFromServer: (pref: ModelPreferenceDTO | null) => void
  clear: () => void
  setPersistError: (error: string | null) => void
}

const normalisePreference = (pref?: ModelPreferenceDTO | null): PreferredModelState | null => {
  if (!pref) return null
  if (!pref.modelId) return null
  return {
    modelId: pref.modelId,
    connectionId: typeof pref.connectionId === 'number' ? pref.connectionId : null,
    rawId: pref.rawId ?? null,
  }
}

export const derivePreferredFromModel = (model: ModelItem): PreferredModelState => ({
  modelId: model.id,
  connectionId: typeof model.connectionId === 'number' ? model.connectionId : null,
  rawId: model.rawId ?? null,
})

export const useModelPreferenceStore = create<ModelPreferenceStore>()(
  persist(
    (set) => ({
      preferred: null,
      lastPersistError: null,
      setLocalPreference: (pref) => set({ preferred: pref ?? null }),
      hydrateFromServer: (pref) => set({ preferred: normalisePreference(pref) }),
      clear: () => set({ preferred: null, lastPersistError: null }),
      setPersistError: (error) => set({ lastPersistError: error }),
    }),
    {
      name: 'model-preference',
      partialize: (state) => ({ preferred: state.preferred }),
    }
  )
)

type PersistOptions = {
  actorType?: 'user' | 'anonymous'
  signal?: AbortSignal
}

export const persistPreferredModel = async (model: ModelItem | null, options?: PersistOptions) => {
  const store = useModelPreferenceStore.getState()
  const nextPref = model ? derivePreferredFromModel(model) : null
  const current = store.preferred
  const isSame = (
    (!current && !nextPref) ||
    (current && nextPref && current.modelId === nextPref.modelId && current.connectionId === nextPref.connectionId && current.rawId === nextPref.rawId)
  )
  if (!isSame) {
    store.setLocalPreference(nextPref)
  }

  const actorType = options?.actorType ?? 'anonymous'
  if (actorType !== 'user') {
    store.setPersistError(null)
    return
  }

  if (isSame) {
    store.setPersistError(null)
    return
  }

  try {
    await apiClient.updatePersonalSettings({
      preferredModel: model
        ? {
            modelId: model.id,
            connectionId: typeof model.connectionId === 'number' ? model.connectionId : null,
            rawId: model.rawId ?? null,
          }
        : null,
    }, options?.signal)
    store.setPersistError(null)
  } catch (error: any) {
    const message = error?.response?.data?.error || error?.message || '同步偏好失败'
    store.setPersistError(message)
  }
}

export const resolvePreferredModel = (models: ModelItem[]): { match: ModelItem | null; preferred: PreferredModelState | null } => {
  const preferred = useModelPreferenceStore.getState().preferred
  if (!preferred) {
    return { match: null, preferred: null }
  }
  const match = findPreferredModel(models, preferred)
  return { match, preferred }
}

export const modelKeyFor = (model: Pick<ModelItem, 'connectionId' | 'rawId' | 'id'>): string => {
  const cid = model.connectionId != null ? String(model.connectionId) : 'global'
  const rid = model.rawId ?? model.id
  return `${cid}:${rid}`
}

export const findPreferredModel = (models: ModelItem[], preferred: PreferredModelState | null): ModelItem | null => {
  if (!preferred) return null
  return models.find((model) => {
    if (model.id === preferred.modelId) return true
    if (preferred.rawId && model.rawId === preferred.rawId) {
      if (preferred.connectionId == null || model.connectionId == null) return true
      return preferred.connectionId === model.connectionId
    }
    return false
  }) || null
}
