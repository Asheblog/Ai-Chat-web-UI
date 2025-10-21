import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SettingsState, SystemSettings, ModelConfig } from '@/types'
import { apiClient } from '@/lib/api'

interface SettingsStore extends SettingsState {
  fetchPersonalModels: () => Promise<void>
  fetchSystemSettings: () => Promise<void>
  createPersonalModel: (name: string, apiUrl: string, apiKey: string, supportsImages?: boolean) => Promise<void>
  createSystemModel: (name: string, apiUrl: string, apiKey: string, supportsImages?: boolean) => Promise<void>
  updatePersonalModel: (modelId: number, updates: Partial<{ name: string; apiUrl: string; apiKey: string; supportsImages: boolean }>) => Promise<void>
  deletePersonalModel: (modelId: number) => Promise<void>
  updateSystemSettings: (settings: Partial<SystemSettings>) => Promise<void>
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setMaxTokens: (maxTokens: number) => void
  clearError: () => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      theme: 'system',
      maxTokens: 4000,
      personalModels: [],
      systemSettings: null,
      isLoading: false,
      error: null,

      fetchPersonalModels: async () => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.getPersonalModels()
          set({
            personalModels: response.data || [],
            isLoading: false,
          })
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '获取个人模型失败',
            isLoading: false,
          })
        }
      },

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

      createPersonalModel: async (name: string, apiUrl: string, apiKey: string, supportsImages?: boolean) => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.createModelConfig(name, apiUrl, apiKey, supportsImages)
          const newModel = response.data

          set((state) => ({
            personalModels: [...state.personalModels, newModel],
            isLoading: false,
          }))
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '创建模型配置失败',
            isLoading: false,
          })
        }
      },

      createSystemModel: async (name: string, apiUrl: string, apiKey: string, supportsImages?: boolean) => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.createSystemModel(name, apiUrl, apiKey)
          const newModel = response.data

          set((state) => ({
            // 系统模型通过 systemSettings 聚合展示，这里仅触发刷新
            systemSettings: state.systemSettings
              ? { ...state.systemSettings, systemModels: [...(state.systemSettings.systemModels || []), newModel] }
              : state.systemSettings,
            isLoading: false,
          }))
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '创建系统模型失败',
            isLoading: false,
          })
        }
      },

      updatePersonalModel: async (modelId: number, updates: Partial<{ name: string; apiUrl: string; apiKey: string; supportsImages: boolean }>) => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.updateModelConfig(modelId, updates)
          const updatedModel = response.data

          set((state) => ({
            personalModels: state.personalModels.map(model =>
              model.id === modelId ? updatedModel : model
            ),
            isLoading: false,
          }))
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '更新模型配置失败',
            isLoading: false,
          })
        }
      },

      deletePersonalModel: async (modelId: number) => {
        set({ isLoading: true, error: null })
        try {
          await apiClient.deleteModelConfig(modelId)

          set((state) => ({
            personalModels: state.personalModels.filter(model => model.id !== modelId),
            isLoading: false,
          }))
        } catch (error: any) {
          set({
            error: error.response?.data?.error || error.message || '删除模型配置失败',
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

      clearError: () => {
        set({ error: null })
      },
    }),
    {
      name: 'settings-storage',
      partialize: (state) => ({
        theme: state.theme,
        maxTokens: state.maxTokens,
      }),
    }
  )
)
