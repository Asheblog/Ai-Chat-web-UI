import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AuthState, User, ActorContextDTO } from '@/types'
import { apiClient } from '@/lib/api'

interface AuthStore extends AuthState {
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
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
          await apiClient.register(username, password)
          await get().fetchActor()
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
        let user: User | null = null
        if (context.actor.type === 'user') {
          const profile = context.user ?? null
          const createdAtSource = profile?.createdAt ?? null
          const createdAt = createdAtSource ? new Date(createdAtSource).toISOString() : new Date().toISOString()
          user = {
            id: profile?.id ?? context.actor.id,
            username: profile?.username ?? context.actor.username,
            role: profile?.role ?? context.actor.role,
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
