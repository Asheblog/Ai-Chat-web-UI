import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BrandThemeColors } from '@aichat/shared'
import { SettingsState, SystemSettings } from '@/types'
import {
  getPublicBranding as getPublicBrandingApi,
  getSystemSettings as fetchSystemSettingsApi,
  updateSystemSettings as updateSystemSettingsApi,
} from '@/features/settings/api'
import {
  isAvatarImageLoaded,
  normalizeAvatarUrl,
  preloadAvatarImage,
} from '@/lib/avatar-image-cache'

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
  setContextEnabled: (enabled: boolean) => void
  setNewConversationContextEnabled: (enabled: boolean) => void
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

const themeFromSystemSettings = (settings?: SystemSettings | null): BrandThemeColors => {
  if (!settings) return {}
  return {
    brand_primary: settings.brandPrimary || undefined,
    brand_primary_foreground: settings.brandPrimaryForeground || undefined,
    brand_background: settings.brandBackground || undefined,
    brand_surface: settings.brandSurface || undefined,
    brand_foreground: settings.brandForeground || undefined,
    brand_muted_foreground: settings.brandMutedForeground || undefined,
  }
}

const themeFromPublicBranding = (data?: {
  brand_primary?: string | null
  brand_primary_foreground?: string | null
  brand_background?: string | null
  brand_surface?: string | null
  brand_foreground?: string | null
  brand_muted_foreground?: string | null
} | null): BrandThemeColors => {
  if (!data) return {}
  const theme: BrandThemeColors = {}
  const assign = (key: keyof BrandThemeColors, value?: string | null) => {
    if (typeof value === 'string' && value.trim()) {
      theme[key] = value.trim()
    }
  }
  assign('brand_primary', data.brand_primary)
  assign('brand_primary_foreground', data.brand_primary_foreground)
  assign('brand_background', data.brand_background)
  assign('brand_surface', data.brand_surface)
  assign('brand_foreground', data.brand_foreground)
  assign('brand_muted_foreground', data.brand_muted_foreground)
  return theme
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => {
      const ensureAssistantAvatarReady = (url?: string | null) => {
        if (typeof window === 'undefined') return
        const normalized = normalizeAvatarUrl(url)
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
        if (isAvatarImageLoaded(normalized)) {
          set((state) => {
            if (state.assistantAvatarReadyFor !== normalized) return state
            if (state.assistantAvatarReady) return state
            return { ...state, assistantAvatarReady: true }
          })
          return
        }
        preloadAvatarImage(normalized).then((success) => {
          set((state) => {
            if (state.assistantAvatarReadyFor !== normalized) return state
            if (state.assistantAvatarReady === success) return state
            return { ...state, assistantAvatarReady: success }
          })
        })
      }
      let systemSettingsInFlight: Promise<void> | null = null
      let publicBrandingInFlight: Promise<boolean> | null = null

      return {
        contextEnabled: true,
        newConversationContextEnabled: false,
        sidebarCollapsed: false,
        systemSettings: null,
        isLoading: false,
        error: null,
        publicBrandText: null,
        publicBrandTheme: null,
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
                publicBrandTheme: themeFromSystemSettings(merged),
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
            publicBrandTheme: themeFromSystemSettings(updatedSettings),
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
        if (publicBrandingInFlight) return publicBrandingInFlight
        publicBrandingInFlight = (async () => {
          try {
            const response = await getPublicBrandingApi()
            const data = response.data
            const normalized = normalizeBrandText(data?.brand_text)
            const theme = themeFromPublicBranding(data)
            if (!normalized && Object.keys(theme).length === 0) return false
            set((state) => ({
              publicBrandText: normalized ?? state.publicBrandText,
              publicBrandTheme: theme,
              systemSettings: state.systemSettings
                ? {
                    ...state.systemSettings,
                    ...(normalized ? { brandText: normalized } : {}),
                    brandPrimary: data?.brand_primary ?? state.systemSettings.brandPrimary,
                    brandPrimaryForeground:
                      data?.brand_primary_foreground ?? state.systemSettings.brandPrimaryForeground,
                    brandBackground: data?.brand_background ?? state.systemSettings.brandBackground,
                    brandSurface: data?.brand_surface ?? state.systemSettings.brandSurface,
                    brandForeground: data?.brand_foreground ?? state.systemSettings.brandForeground,
                    brandMutedForeground:
                      data?.brand_muted_foreground ?? state.systemSettings.brandMutedForeground,
                  }
                : state.systemSettings,
            }))
            return true
          } catch (error) {
            console.warn('[settings-store] failed to fetch branding:', error)
            return false
          } finally {
            publicBrandingInFlight = null
          }
        })()
        return publicBrandingInFlight
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

      setContextEnabled: (enabled: boolean) => {
        set({ contextEnabled: !!enabled })
      },

      setNewConversationContextEnabled: (enabled: boolean) => {
        set({ newConversationContextEnabled: !!enabled })
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
        contextEnabled: state.contextEnabled,
        newConversationContextEnabled: state.newConversationContextEnabled,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
)
