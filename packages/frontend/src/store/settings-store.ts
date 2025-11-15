import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SettingsState, SystemSettings } from '@/types'
import { apiClient } from '@/lib/api'

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
  setMaxTokens: (maxTokens: number) => void
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
    (set, get) => ({
      theme: 'system',
      maxTokens: 4000,
      contextEnabled: true,
      sidebarCollapsed: false,
      systemSettings: null,
      isLoading: false,
      error: null,
      publicBrandText: null,

      fetchSystemSettings: async () => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.getSystemSettings()
          const prevSettings = get().systemSettings
          const merged = mergeSystemSettings(prevSettings, response.data)
          const normalizedBrand = normalizeBrandText(merged.brandText)
          set((state) => ({
            systemSettings: merged,
            publicBrandText: normalizedBrand ?? state.publicBrandText,
            isLoading: false,
          }))
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '获取系统设置失败',
            isLoading: false,
          })
        }
      },

      updateSystemSettings: async (settings: SystemSettingsUpdatePayload) => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.updateSystemSettings(settings)
          const prevSettings = get().systemSettings
          const updatedSettings = mergeSystemSettings(prevSettings, response.data)
          const normalizedBrand = normalizeBrandText(updatedSettings.brandText)

          set((state) => ({
            systemSettings: updatedSettings,
            publicBrandText: normalizedBrand ?? state.publicBrandText,
            isLoading: false,
          }))
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '更新系统设置失败',
            isLoading: false,
          })
        }
      },

      fetchPublicBranding: async () => {
        try {
          const response = await apiClient.getPublicBranding()
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

      setMaxTokens: (maxTokens: number) => {
        set({ maxTokens })
      },

      setContextEnabled: (enabled: boolean) => {
        set({ contextEnabled: !!enabled })
      },

      setSidebarCollapsed: (v: boolean) => { set({ sidebarCollapsed: !!v }) },

      clearError: () => {
        set({ error: null })
      },
    }),
    {
      name: 'settings-storage',
      partialize: (state) => ({
        theme: state.theme,
        maxTokens: state.maxTokens,
        contextEnabled: state.contextEnabled,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
)
