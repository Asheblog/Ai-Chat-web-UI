import { useCallback, useEffect } from "react"
import { useSystemSettings } from "@/hooks/use-system-settings"
import type { SystemSettings } from "@/types"

export type SectionSettingsState =
  | { mode: "loading" }
  | { mode: "error"; error: string | null; retry: () => void }
  | {
      mode: "ready"
      settings: SystemSettings
      update: (patch: Partial<SystemSettings>) => Promise<void>
      retry: () => void
    }

/**
 * 能力扩展段的取数与三态阶梯，供各段共用。
 *
 * 判定只有两条：拿不到 settings 且没有失败原因就是加载中（刚挂载/补拉中），
 * 拿不到 settings 但有原因才是错误态；拿到 settings 一律 ready，此时的失败由卡片自己提示。
 * retry 先清掉旧错误再拉一次，避免错误态残留；补拉失败不抛给调用方，由下一次重渲染呈现。
 */
export function useSectionSettings(): SectionSettingsState {
  const { settings, error, refresh, update, clearError } = useSystemSettings()

  const retry = useCallback(() => {
    clearError()
    void refresh().catch(() => {})
  }, [clearError, refresh])

  // 冷启动直接落到本段（搜索/深链）时 store 里可能还没有设置：补拉一次，
  // 依赖只有 settings 与稳定的 refresh，拉到值后本 effect 自然不再触发。
  useEffect(() => {
    if (settings) return
    void refresh().catch(() => {})
  }, [settings, refresh])

  if (!settings) {
    return error ? { mode: "error", error, retry } : { mode: "loading" }
  }

  return { mode: "ready", settings, update, retry }
}
