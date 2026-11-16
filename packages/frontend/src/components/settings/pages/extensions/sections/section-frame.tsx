"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { sectionMeta, type ExtensionSection } from "../extensions-sections"
import type { SectionSettingsState } from "./use-section-settings"

/** ready 分支的收窄类型：卡片只要 settings 与 update，重试入口留在段壳里。 */
export type ReadySectionSettings = Extract<SectionSettingsState, { mode: "ready" }>

/** 段标题字阶：桌面 28px / 手机 24px，与设置页其他一级标题同一档。 */
const HEADING_CLASS =
  "text-[24px] font-semibold leading-tight tracking-[-0.3px] text-foreground sm:text-[28px]"

/**
 * 段页标题（标题 + 说明）：各段页头与总览共用同一字阶，改标题样式只改这一处。
 *
 * 段由侧栏单独成页，当前段用 h1（一页一个主标题）；keep-alive 下被 hidden 藏起来的
 * 其他段降为 h2，避免同一份 DOM 里并列多个 h1。
 */
export function SectionPageTitle({
  title,
  description,
  active = true,
}: {
  title: string
  description: string
  /** 本段是否为当前段：决定主标题层级 */
  active?: boolean
}): JSX.Element {
  return (
    <header className="space-y-1">
      {active ? (
        <h1 className={HEADING_CLASS}>{title}</h1>
      ) : (
        <h2 className={HEADING_CLASS}>{title}</h2>
      )}
      <p className="text-sm text-muted-foreground text-pretty">{description}</p>
    </header>
  )
}

/**
 * 段头：标题 + 说明。文案的唯一来源是 EXTENSION_SECTIONS，段组件不再各自硬编码
 * （改标题只改一处）。`aside` 留给段页头右侧的单开关。
 */
export function SectionHeader({
  sectionKey,
  aside,
  active = true,
}: {
  sectionKey: ExtensionSection
  aside?: ReactNode
  /** 本段是否为当前段：决定主标题层级 */
  active?: boolean
}): JSX.Element {
  const meta = sectionMeta(sectionKey)

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <SectionPageTitle title={meta.label} description={meta.description} active={active} />
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  )
}

export interface SectionFrameProps {
  /** 段 key：标题、说明与图标都从 EXTENSION_SECTIONS 取 */
  sectionKey: ExtensionSection
  /** useSectionSettings() 的三态，骨架与错误块都由段壳统一渲染 */
  state: SectionSettingsState
  /** 本段是否为当前段（keep-alive 下其余段 hidden，主标题降为 h2） */
  active?: boolean
  /** 只在 ready 时调用：参数是本段那份 settings 与 update，卡片保持受控 */
  children: (ready: ReadySectionSettings) => ReactNode
}

/**
 * 能力扩展段的统一外壳：段头（SectionHeader）+ 加载骨架 / 错误文案 + 重试按钮。
 *
 * 段组件只声明段 key 与卡片列表；拿不到 settings 时不渲染 children，
 * 避免半加载状态下出现空卡。页头需要挂单开关的 mcp / skill 段直接用 SectionHeader。
 */
export function SectionFrame({ sectionKey, state, active, children }: SectionFrameProps): JSX.Element {
  return (
    <div className="space-y-3">
      <SectionHeader sectionKey={sectionKey} active={active} />

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
