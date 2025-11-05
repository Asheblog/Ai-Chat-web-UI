import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AuthState, User, ActorContextDTO, RegisterResponse } from '@/types'
import { apiClient } from '@/lib/api'
import { useModelPreferenceStore } from '@/store/model-preference-store'

interface AuthStore extends AuthState {
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<RegisterResponse>
  logout: () => Promise<void>
  fetchActor: () => Promise<void>
  setActorContext: (context: ActorContextDTO | null) => void
  updateQuota: (quota: ActorContextDTO['quota']) => void
  setError: (error: string | null) => void
  clearError: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      actor: null,
      user: null,
      quota: null,
      actorState: 'loading',
      isLoading: false,
      error: null,

      login: async (username: string, password: string) => {
        set({ isLoading: true, error: null })
        try {
          await apiClient.login(username, password)
          await get().fetchActor()
        } catch (error: any) {
          const status = error.response?.data?.data?.status
          const rejectionReason = error.response?.data?.data?.rejectionReason
          let errorMessage = error.response?.data?.error || error.message || '登录失败'
          if (status === 'PENDING') {
            errorMessage = '账户正在等待管理员审批，暂时无法登录'
          } else if (status === 'DISABLED') {
            errorMessage = rejectionReason
              ? `账户已被禁用：${rejectionReason}`
              : '账户已被禁用，请联系管理员'
          }
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
          const result = await apiClient.register(username, password)
          if (result.token) {
            await get().fetchActor()
          } else {
            set({ isLoading: false })
          }
          return result
        } catch (error: any) {
          const errorMessage = error.response?.data?.error || error.message || '注册失败'
          set({
            error: errorMessage,
            isLoading: false,
          })
          throw error
        }
      },

      logout: async () => {
        try {
          await apiClient.logout()
        } catch {}
        useModelPreferenceStore.getState().clear()
        set({
          actor: null,
          user: null,
          quota: null,
          actorState: 'anonymous',
          isLoading: false,
          error: null,
        })
      },

      fetchActor: async () => {
        set({ isLoading: true })
        try {
          const context = await apiClient.getActorContext()
          get().setActorContext(context)
        } catch (error: any) {
          console.error('Failed to fetch actor:', error)
          set({
            actor: null,
            user: null,
            quota: null,
            actorState: 'anonymous',
            isLoading: false,
          })
        }
      },

      setActorContext: (context: ActorContextDTO | null) => {
        if (!context) {
          useModelPreferenceStore.getState().clear()
          set({
            actor: null,
            user: null,
            quota: null,
            actorState: 'anonymous',
            isLoading: false,
            error: null,
          })
          return
        }
        const actorState = context.actor.type === 'user' ? 'authenticated' : 'anonymous'
        useModelPreferenceStore.getState().hydrateFromServer(context.preferredModel ?? null)
        let user: User | null = null
        if (context.actor.type === 'user') {
          const profile = context.user ?? null
          const createdAtSource = profile?.createdAt ?? null
          const createdAt = createdAtSource ? new Date(createdAtSource).toISOString() : new Date().toISOString()
          user = {
            id: profile?.id ?? context.actor.id,
            username: profile?.username ?? context.actor.username,
            role: profile?.role ?? context.actor.role,
            status: profile?.status ?? context.actor.status,
            createdAt,
          }
        }
        set({
          actor: context.actor,
          user,
          quota: context.quota ?? null,
          actorState,
          isLoading: false,
          error: null,
        })
      },

      updateQuota: (quota) => {
        set((state) => ({
          quota: quota ?? null,
          actorState: state.actorState === 'loading'
            ? (state.actor?.type === 'user' ? 'authenticated' : 'anonymous')
            : state.actorState,
        }))
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
      partialize: (state) => ({
        actor: state.actor,
        user: state.user,
        quota: state.quota,
        actorState: state.actorState,
      }),
    }
  )
)
