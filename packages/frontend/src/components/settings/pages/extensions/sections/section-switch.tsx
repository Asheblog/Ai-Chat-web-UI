"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { useSystemSettings } from "@/hooks/use-system-settings"

/** 页头单开关只服务全局能力开关；其余设置项归段壳里的卡片。 */
export type SectionSwitchKey =
  | "mcpGlobalEnabled"
  | "chatDynamicSkillRuntimeEnabled"
  | "extensionInstallToolEnable"

export interface SectionSwitchProps {
  settingsKey: SectionSwitchKey
  /** 开关名（「全局」/「运行时」），与状态词拼成「{label} 已开启」 */
  label: string
  onLabel: string
  offLabel: string
  /** Switch 本身的无障碍名（label 关联的是文案，不是控件名） */
  ariaLabel: string
  /** 开关下方的补充说明（如开启后的效果） */
  hint?: string
}

/**
 * 能力扩展段页头的单开关：MCP 全局 / 动态 Skill Runtime 共用。
 *
 * 三态与段壳同源但形态不同（单开关而不是卡片列表），所以单独成件：
 * settings 为 null 且仍在加载 → 禁用并说「状态未知」；null 且有失败原因 → 同上并给错误文案与重试；
 * 有值 → 直接读写共享 store，写入失败时 store 不变，开关自动回到原值。
 */
export function SectionSwitch({
  settingsKey,
  label,
  onLabel,
  offLabel,
  ariaLabel,
  hint,
}: SectionSwitchProps): JSX.Element {
  const { settings, update, refresh, isLoading, error } = useSystemSettings()
  const [saving, setSaving] = useState(false)
  const switchId = useId()

  // 冷启动直接落到本段（搜索/深链）时 store 里可能还没有设置：补拉一次。
  // 拉到值后 effect 自然不再触发，切段（keep-alive）也不会重复请求。
  useEffect(() => {
    if (settings) return
    void refresh().catch(() => {})
  }, [settings, refresh])

  const handleToggle = useCallback(
    async (next: boolean) => {
      setSaving(true)
      try {
        await update({ [settingsKey]: next })
      } catch {
        // 开关值直接来自 store：写入失败时 store 不变，UI 自动回到原状态
      } finally {
        setSaving(false)
      }
    },
    [settingsKey, update],
  )

  // 未取到设置时不猜开关状态：宁可显示「状态未知」并禁用，也不给一个假的确定值。
  const enabled = settings ? Boolean(settings[settingsKey]) : null
  const stateText = settings === null ? "状态未知" : enabled ? onLabel : offLabel

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={enabled === true}
          onCheckedChange={handleToggle}
          disabled={saving || settings === null || isLoading}
          aria-label={ariaLabel}
        />
        <label
          htmlFor={switchId}
          className="cursor-pointer select-none text-xs text-muted-foreground"
        >
          {label} {stateText}
        </label>
        {saving && <span className="text-xs text-ink-tertiary">保存中...</span>}
        {settings === null && error ? (
          <button
            type="button"
            onClick={() => void refresh().catch(() => {})}
            className="text-xs text-signal-text underline-offset-2 hover:underline"
          >
            重试
          </button>
        ) : null}
      </div>
      {settings === null && error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      {hint ? <p className="text-[11px] text-ink-tertiary">{hint}</p> : null}
    </div>
  )
}
