import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AuthState, User } from '@/types'
import { apiClient } from '@/lib/api'

interface AuthStore extends AuthState {
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
  getCurrentUser: () => Promise<void>
  setError: (error: string | null) => void
  clearError: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: false,
      error: null,

      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.login(username, password)
          set({
            user: response.user,
            token: null, // Cookie 会话下不保存在客户端
            isLoading: false,
          })
        } catch (error: any) {
          const errorMessage = error.response?.data?.error || error.message || '登录失败'
          set({
            error: errorMessage,
            isLoading: false,
          })
          throw error
        }
      },

      register: async (username: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          const response = await apiClient.register(username, password)
          set({
            user: response.user,
            token: null,
            isLoading: false,
          })
        } catch (error: any) {
          const errorMessage = error.response?.data?.error || error.message || '注册失败'
          set({
            error: errorMessage,
            isLoading: false,
          })
          throw error
        }
      },

      logout: () => {
        apiClient.logout()
        set({
          user: null,
          token: null,
          error: null,
        })
      },

      getCurrentUser: async () => {
        set({ isLoading: true })
        try {
          const user = await apiClient.getCurrentUser()
          set({
            user,
            isLoading: false,
          })
        } catch (error: any) {
          console.error('Failed to get current user:', error)
          // 如果获取用户信息失败，可能是token过期
          set({
            user: null,
            token: null,
            isLoading: false,
          })
        }
      },

      setError: (error: string | null) => {
        set({ error })
      },

      clearError: () => {
        set({ error: null })
      },
    }),
    {
      name: 'auth-storage',
      // 仅持久化用户信息，token 不存储
      partialize: (state) => ({ user: state.user }),
    }
  )
)
