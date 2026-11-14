"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { sectionMeta, type ExtensionSection } from "../extensions-sections"
import type { SectionSettingsState } from "./use-section-settings"

/** ready 分支的收窄类型：卡片只要 settings 与 update，重试入口留在段壳里。 */
export type ReadySectionSettings = Extract<SectionSettingsState, { mode: "ready" }>

/**
 * 段头：图标 + 标题 + 说明。文案与图标的唯一来源是 EXTENSION_SECTIONS，
 * 段组件不再各自硬编码（改标题只改一处）。`aside` 留给段页头右侧的单开关。
 */
export function SectionHeader({
  sectionKey,
  aside,
}: {
  sectionKey: ExtensionSection
  aside?: ReactNode
}): JSX.Element {
  const meta = sectionMeta(sectionKey)
  const Icon = meta.icon

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0 space-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {meta.label}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">{meta.description}</p>
      </div>
      {aside}
    </div>
  )
}

export interface SectionFrameProps {
  /** 段 key：标题、说明与图标都从 EXTENSION_SECTIONS 取 */
  sectionKey: ExtensionSection
  /** useSectionSettings() 的三态，骨架与错误块都由段壳统一渲染 */
  state: SectionSettingsState
  /** 只在 ready 时调用：参数是本段那份 settings 与 update，卡片保持受控 */
  children: (ready: ReadySectionSettings) => ReactNode
}

/**
 * 能力扩展段的统一外壳：段头（SectionHeader）+ 加载骨架 / 错误文案 + 重试按钮。
 *
 * 段组件只声明段 key 与卡片列表；拿不到 settings 时不渲染 children，
 * 避免半加载状态下出现空卡。页头需要挂单开关的 mcp / skill 段直接用 SectionHeader。
 */
export function SectionFrame({ sectionKey, state, children }: SectionFrameProps): JSX.Element {
  return (
    <div className="space-y-3">
      <SectionHeader sectionKey={sectionKey} />

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
