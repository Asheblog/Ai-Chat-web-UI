"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

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
 * SettingRow: 统一设置项的展示布局，左侧描述固定宽度，右侧控件区保持一致的最大宽度。
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
        "rounded-[10px] border border-border/70 bg-white/85 px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.035)] sm:px-5 sm:py-4 flex flex-col gap-4 sm:flex-row sm:gap-6",
        align === "center" ? "sm:items-center" : "sm:items-start",
        className,
      )}
    >
      <div
        className={cn(
          "shrink-0 w-full sm:w-[360px] text-sm text-muted-foreground",
          descriptionWidthClassName,
        )}
      >
        <div className="text-base text-foreground/90 leading-6">{title}</div>
        {description ? (
          <p className="mt-1 leading-relaxed text-sm">{description}</p>
        ) : null}
      </div>
      <div
        className={cn(
          "w-full flex sm:flex-1 sm:justify-end",
          controlWidthClassName,
        )}
      >
        {children}
      </div>
    </div>
  )
}
