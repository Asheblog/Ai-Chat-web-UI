"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import {
  SETTINGS_FIELD_CONTROL,
  SETTINGS_FIELD_HINT,
  SETTINGS_FIELD_LABEL,
  SETTINGS_FIELD_ROW,
  SETTINGS_FIELD_TITLE,
} from "./settings-surfaces"

interface SettingRowProps {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
  align?: "start" | "center"
  descriptionWidthClassName?: string
  controlWidthClassName?: string
}

/**
 * SettingRow: 设置项统一排布——左侧 150 宽标签列（标签 13 Medium + 说明 11.5 ink-tertiary），右侧控件区。
 * 行自身不画框也不投影：外层卡片负责发丝线，行只用字号与间距分层，控件统一左起。
 */
export function SettingRow({
  title,
  description,
  children,
  className,
  align = "center",
  descriptionWidthClassName,
  controlWidthClassName,
}: SettingRowProps) {
  return (
    <div
      className={cn(
        SETTINGS_FIELD_ROW,
        align === "center" ? "sm:items-center" : "sm:items-start",
        className,
      )}
    >
      <div className={cn(SETTINGS_FIELD_LABEL, descriptionWidthClassName)}>
        <div className={SETTINGS_FIELD_TITLE}>{title}</div>
        {description ? <p className={SETTINGS_FIELD_HINT}>{description}</p> : null}
      </div>
      <div className={cn(SETTINGS_FIELD_CONTROL, controlWidthClassName)}>{children}</div>
    </div>
  )
}
