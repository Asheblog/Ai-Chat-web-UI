import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SettingsState, SystemSettings } from '@/types'
import {
  getPublicBranding as getPublicBrandingApi,
  getSystemSettings as fetchSystemSettingsApi,
  updateSystemSettings as updateSystemSettingsApi,
} from '@/features/settings/api'

const avatarReadyCache = new Map<string, boolean>()
const preloadImage = (url: string): Promise<boolean> => {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (!url || typeof url !== 'string') return Promise.resolve(false)
  return new Promise((resolve) => {
    const img = new window.Image()
    img.decoding = 'async'
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
}

type AvatarUploadPayload = { data: string; mime: string }
type SystemSettingsUpdatePayload = Partial<SystemSettings> & {
  assistantAvatarUpload?: AvatarUploadPayload | null
  assistantAvatarRemove?: boolean
}

interface SettingsStore extends SettingsState {
  fetchSystemSettings: () => Promise<void>
  updateSystemSettings: (settings: SystemSettingsUpdatePayload) => Promise<void>
  fetchPublicBranding: () => Promise<boolean>
  bootstrapBrandText: (brandText?: string | null) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setContextEnabled: (enabled: boolean) => void
  // UI：侧边栏折叠
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  clearError: () => void
}

const pickBrandText = (incoming?: string, current?: string) => {
  const normalizedIncoming = typeof incoming === 'string' ? incoming.trim() : ''
  if (normalizedIncoming) return incoming
  const normalizedCurrent = typeof current === 'string' ? current.trim() : ''
  if (normalizedCurrent) return current
  return incoming ?? current ?? undefined
}

const mergeSystemSettings = (current: SystemSettings | null, incoming: SystemSettings): SystemSettings => ({
  ...(current ?? {}),
  ...incoming,
  brandText: pickBrandText(incoming.brandText, current?.brandText),
})

const normalizeBrandText = (value?: string | null) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => {
      const ensureAssistantAvatarReady = (url?: string | null) => {
        if (typeof window === 'undefined') return
        const normalized = typeof url === 'string' ? url.trim() : ''
        if (!normalized) {
          set((state) => {
            if (!state.assistantAvatarReady && state.assistantAvatarReadyFor === null) {
              return state
            }
            return { ...state, assistantAvatarReady: false, assistantAvatarReadyFor: null }
          })
          return
        }
        set((state) => {
          if (state.assistantAvatarReadyFor === normalized && state.assistantAvatarReady) {
            return state
          }
          if (state.assistantAvatarReadyFor === normalized && !state.assistantAvatarReady) {
            return state
          }
          return { ...state, assistantAvatarReady: false, assistantAvatarReadyFor: normalized }
        })
        if (avatarReadyCache.has(normalized)) {
          set((state) => {
            if (state.assistantAvatarReadyFor !== normalized) return state
            if (state.assistantAvatarReady) return state
            return { ...state, assistantAvatarReady: true }
          })
          return
        }
        preloadImage(normalized).then((success) => {
          if (success) {
            avatarReadyCache.set(normalized, true)
          }
          set((state) => {
            if (state.assistantAvatarReadyFor !== normalized) return state
            if (state.assistantAvatarReady === success) return state
            return { ...state, assistantAvatarReady: success }
          })
        })
      }
      let systemSettingsInFlight: Promise<void> | null = null

      return {
        theme: 'system',
        contextEnabled: true,
        sidebarCollapsed: false,
        systemSettings: null,
        isLoading: false,
        error: null,
        publicBrandText: null,
        assistantAvatarReady: false,
        assistantAvatarReadyFor: null,

        fetchSystemSettings: async () => {
          if (systemSettingsInFlight) return systemSettingsInFlight
          set({ isLoading: true, error: null })
          systemSettingsInFlight = (async () => {
            try {
              const response = await fetchSystemSettingsApi()
              const prevSettings = get().systemSettings
              const merged = mergeSystemSettings(prevSettings, response.data)
              const normalizedBrand = normalizeBrandText(merged.brandText)
              set((state) => ({
                systemSettings: merged,
                publicBrandText: normalizedBrand ?? state.publicBrandText,
                isLoading: false,
              }))
              ensureAssistantAvatarReady(merged.assistantAvatarUrl)
            } catch (error: any) {
              set({
                error: error.response?.data?.error || error.message || '获取系统设置失败',
                isLoading: false,
              })
            } finally {
              systemSettingsInFlight = null
            }
          })()
          return systemSettingsInFlight
        },

        updateSystemSettings: async (settings: SystemSettingsUpdatePayload) => {
          set({ isLoading: true, error: null })
          try {
            const response = await updateSystemSettingsApi(settings)
            const prevSettings = get().systemSettings
            const updatedSettings = mergeSystemSettings(prevSettings, response.data)
            const normalizedBrand = normalizeBrandText(updatedSettings.brandText)

          set((state) => ({
            systemSettings: updatedSettings,
            publicBrandText: normalizedBrand ?? state.publicBrandText,
            isLoading: false,
          }))
            ensureAssistantAvatarReady(updatedSettings.assistantAvatarUrl)
          } catch (error: any) {
            set({
              error: error.response?.data?.error || error.message || '更新系统设置失败',
              isLoading: false,
            })
          }
        },

      fetchPublicBranding: async () => {
        try {
          const response = await getPublicBrandingApi()
          const normalized = normalizeBrandText(response.data?.brand_text)
          if (!normalized) return false
          set((state) => ({
            publicBrandText: normalized,
            systemSettings: state.systemSettings
              ? { ...state.systemSettings, brandText: normalized }
              : state.systemSettings,
          }))
          return true
        } catch (error) {
          console.warn('[settings-store] failed to fetch branding:', error)
          return false
        }
      },

      bootstrapBrandText: (brandText?: string | null) => {
        const normalized = normalizeBrandText(brandText)
        if (!normalized) return
        const state = get()
        const currentNormalized = normalizeBrandText(state.systemSettings?.brandText ?? state.publicBrandText)
        if (currentNormalized === normalized) return
        set((state) => ({
          publicBrandText: normalized,
          systemSettings: state.systemSettings
            ? { ...state.systemSettings, brandText: normalized }
            : state.systemSettings,
        }))
      },

      setTheme: (theme: 'light' | 'dark' | 'system') => {
        set({ theme })
        // 应用主题到DOM
        if (typeof window !== 'undefined') {
          const root = window.document.documentElement
          root.classList.remove('light', 'dark')

          if (theme === 'system') {
            const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            root.classList.add(systemTheme)
          } else {
            root.classList.add(theme)
          }
        }
      },

      setContextEnabled: (enabled: boolean) => {
        set({ contextEnabled: !!enabled })
      },

      setSidebarCollapsed: (v: boolean) => { set({ sidebarCollapsed: !!v }) },

        clearError: () => {
          set({ error: null })
        },
      }
    },
    {
      name: 'settings-storage',
      partialize: (state) => ({
        theme: state.theme,
        contextEnabled: state.contextEnabled,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
)
