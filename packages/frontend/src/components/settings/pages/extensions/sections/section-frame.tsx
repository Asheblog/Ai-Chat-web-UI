"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { SectionSettingsState } from "./use-section-settings"

/** ready 分支的收窄类型：卡片只要 settings 与 update，重试入口留在段壳里。 */
export type ReadySectionSettings = Extract<SectionSettingsState, { mode: "ready" }>

export interface SectionFrameProps {
  /** 段头图标（Lucide 组件） */
  icon: LucideIcon
  /** 段头标题，与左侧段导航文案一致 */
  title: string
  /** 段头说明：一句话讲清本段管什么 */
  description: string
  /** useSectionSettings() 的三态，骨架与错误块都由段壳统一渲染 */
  state: SectionSettingsState
  /** 只在 ready 时调用：参数是本段那份 settings 与 update，卡片保持受控 */
  children: (ready: ReadySectionSettings) => ReactNode
}

/**
 * 能力扩展段的统一外壳：段头（图标 + 标题 + 说明）、加载骨架、错误文案与重试按钮。
 *
 * 此前各段各自复制这套三态阶梯与段头样式，段壳把它收成一处：段组件只声明
 * 段头文案与卡片列表；拿不到 settings 时不渲染 children，避免半加载状态下出现空卡。
 */
export function SectionFrame({
  icon: Icon,
  title,
  description,
  state,
  children,
}: SectionFrameProps): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            {title}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">{description}</p>
        </div>
      </div>

      {state.mode === "ready" ? (
        children(state)
      ) : state.mode === "error" ? (
        <div className="py-4 text-center text-sm text-muted-foreground">
          <p>{state.error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={state.retry}>
            重试
          </Button>
        </div>
      ) : (
        // 还没有结果也没有失败原因（刚挂载/补拉中）：先占位，不把「加载中」说成错误
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </div>
  )
}
