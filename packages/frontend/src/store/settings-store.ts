import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SettingsState, SystemSettings } from '@/types'
import { apiClient } from '@/lib/api'

interface SettingsStore extends SettingsState {
  fetchSystemSettings: () => Promise<void>
  updateSystemSettings: (settings: Partial<SystemSettings>) => Promise<void>
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setMaxTokens: (maxTokens: number) => void
  // UI：侧边栏折叠
  sidebarCollapsed: boolean
  setSidebarCollapsed: (v: boolean) => void
  clearError: () => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      theme: 'system',
      maxTokens: 4000,
      sidebarCollapsed: false,
      systemSettings: null,
      isLoading: false,
      error: null,

      fetchSystemSettings: async () => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.getSystemSettings()
          set({
            systemSettings: response.data,
            isLoading: false,
          })
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '获取系统设置失败',
            isLoading: false,
          })
        }
      },

      updateSystemSettings: async (settings: Partial<SystemSettings>) => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.updateSystemSettings(settings)
          const updatedSettings = response.data

          set({
            systemSettings: updatedSettings,
            isLoading: false,
          })
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '更新系统设置失败',
            isLoading: false,
          })
        }
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
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
)
