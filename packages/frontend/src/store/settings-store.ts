import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BrandThemeColors } from '@aichat/shared'
import { SettingsState, SystemSettings } from '@/types'
import {
  getPublicBranding as getPublicBrandingApi,
  getSystemSettings as fetchSystemSettingsApi,
  updateSystemSettings as updateSystemSettingsApi,
} from '@/features/settings/api'
import { normalizeAvatarUrl, preloadAvatarImage } from '@/lib/avatar-image-cache'

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
      const syncAssistantAvatar = (url?: string | null) => {
        const normalized = normalizeAvatarUrl(url) || null
        set((state) =>
          state.assistantAvatarUrl === normalized ? state : { assistantAvatarUrl: normalized },
        )
        if (!normalized || typeof window === 'undefined') return
        // 预热到浏览器缓存，气泡挂载时 Radix 的探测图就能同步命中，不必再等一次网络往返。
        void preloadAvatarImage(normalized)
      }
      let systemSettingsInFlight: Promise<void> | null = null
      let publicBrandingInFlight: Promise<boolean> | null = null

      return {
        sidebarCollapsed: false,
        systemSettings: null,
        isLoading: false,
        error: null,
        publicBrandText: null,
        publicBrandTheme: null,
        assistantAvatarUrl: null,

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
              syncAssistantAvatar(merged.assistantAvatarUrl)
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
            syncAssistantAvatar(updatedSettings.assistantAvatarUrl)
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

      setSidebarCollapsed: (v: boolean) => { set({ sidebarCollapsed: !!v }) },

        clearError: () => {
          set({ error: null })
        },
      }
    },
    {
      name: 'settings-storage',
      // 上下文开关已迁到 users.contextEnabled（账号级单一真源）。
      // zustand 会把持久化值 merge 回 state，所以必须显式剥掉旧键，
      // 否则 localStorage 里的历史值会作为没人读的脏字段长期留在内存里。
      version: 2,
      migrate: (persisted: any) => {
        if (!persisted || typeof persisted !== 'object') return persisted
        const { contextEnabled: _c, newConversationContextEnabled: _n, ...rest } = persisted
        return rest
      },
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        // 头像 URL 必须跟着持久化：否则每次整页加载都要等 /api/settings 回来才有 <img src>，
        // 图片缓存再好也省不掉那一跳。
        assistantAvatarUrl: state.assistantAvatarUrl,
      }),
    }
  )
)
