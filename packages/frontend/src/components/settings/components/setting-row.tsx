"use client"

import { useId, type ReactNode } from "react"
import styles from "./settings-fields.module.css"
import { cn } from "@/lib/utils"
import {
  SETTINGS_FIELD_CONTROL,
  SETTINGS_FIELD_HINT,
  SETTINGS_FIELD_LABEL,
  SETTINGS_FIELD_TITLE,
} from "./settings-surfaces"

interface SettingRowProps {
  title: ReactNode
  description?: ReactNode
  children: ReactNode | ((descriptionId: string | undefined) => ReactNode)
  className?: string
  align?: "start" | "center"
  layout?: "responsive" | "stacked"
  descriptionWidthClassName?: string
  controlWidthClassName?: string
  htmlFor?: string
}

/**
 * 设置项按卡片可用宽度排列：宽屏说明与控件分列，窄屏上下堆叠。
 * 长文本使用 stacked；children 回调提供说明 ID，供控件设置 aria-describedby。
 */
export function SettingRow({
  title,
  description,
  children,
  className,
  align = "center",
  layout = "responsive",
  descriptionWidthClassName,
  controlWidthClassName,
  htmlFor,
}: SettingRowProps) {
  const generatedId = useId()
  const descriptionId = description ? generatedId : undefined
  return (
    <div className={styles.container} role="group" aria-describedby={descriptionId}>
      <div
        className={cn(
          styles.row,
          layout === "stacked" && styles.stacked,
          align === "center" ? "items-center" : "items-start",
          className,
        )}
      >
        <div className={cn(SETTINGS_FIELD_LABEL, descriptionWidthClassName)}>
          {htmlFor ? <label htmlFor={htmlFor} className={cn("block", SETTINGS_FIELD_TITLE)}>{title}</label> : <div className={SETTINGS_FIELD_TITLE}>{title}</div>}
          {description ? <p id={descriptionId} className={SETTINGS_FIELD_HINT}>{description}</p> : null}
        </div>
        <div className={cn(SETTINGS_FIELD_CONTROL, styles.control, controlWidthClassName)}>{typeof children === "function" ? children(descriptionId) : children}</div>
      </div>
    </div>
  )
}
