import { useCallback } from "react"
import { useSettingsStore } from "@/store/settings-store"
import type { SystemSettings } from "@/types"

type UseSystemSettingsResult = {
  settings: SystemSettings | null
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  update: (payload: Partial<SystemSettings>) => Promise<void>
  clearError: () => void
}

/**
 * 封装系统设置的读取与更新，统一对外暴露的接口，方便后续抽象为 React Query 或独立 service。
 */
export function useSystemSettings(): UseSystemSettingsResult {
  const {
    systemSettings,
    isLoading,
    error,
    fetchSystemSettings,
    updateSystemSettings,
    clearError,
  } = useSettingsStore((state) => ({
    systemSettings: state.systemSettings,
    isLoading: state.isLoading,
    error: state.error,
    fetchSystemSettings: state.fetchSystemSettings,
    updateSystemSettings: state.updateSystemSettings,
    clearError: state.clearError,
  }))

  const refresh = useCallback(() => fetchSystemSettings(), [fetchSystemSettings])
  const update = useCallback((payload: Partial<SystemSettings>) => updateSystemSettings(payload), [updateSystemSettings])

  return {
    settings: systemSettings,
    isLoading,
    error,
    refresh,
    update,
    clearError,
  }
}
