"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { SectionRail } from "../../components/section-rail"
import { SegmentedTabs } from "../../components/segmented-tabs"
import {
  EXTENSION_SECTIONS,
  EXTENSION_SEGMENTS,
  EXTENSION_SECTION_EVENT,
  routeForCard,
  type ExtensionCardRoute,
  type ExtensionSection,
  type ExtensionSectionEventDetail,
} from "./extensions-sections"
import { OverviewSection } from "./sections/overview-section"

const DEFAULT_MCP_SEGMENT = "installations"
const DEFAULT_SKILL_SEGMENT = "install"

/** 每段合法次级标签 key，用于丢弃事件里越界的 segment。 */
const SEGMENT_KEYS: Partial<Record<ExtensionSection, readonly string[]>> = {
  mcp: EXTENSION_SEGMENTS.mcp.map((item) => item.key),
  skills: EXTENSION_SEGMENTS.skills.map((item) => item.key),
}

function isExtensionSection(value: unknown): value is ExtensionSection {
  return typeof value === "string" && EXTENSION_SECTIONS.some((item) => item.key === value)
}

/**
 * 能力扩展：MCP 服务 / Skill / 内置工具 / 对话增强的统一入口。
 *
 * 本任务只落地骨架：段路由、卡定位（flash-bus + 三个 window 事件）与占位面板；
 * 各段真实内容由后续任务接入。
 */
export function ExtensionsPage({
  hostId,
  initialCardKey,
}: {
  hostId?: string
  /** 冷启动目标卡：由 renderSystemLeaf 在渲染期读取 flash-bus 后传入（页面挂载前请求已被 wrapper 消费） */
  initialCardKey?: string
}): JSX.Element {
  // 冷启动首次渲染就必须落在目标段/次级标签上，否则卡元素根本不会挂载，wrapper 的重试必然落空
  const initialRoute = initialCardKey ? routeForCard(initialCardKey) : null
  const [section, setSection] = useState<ExtensionSection>(initialRoute?.section ?? "overview")
  const [mcpSegment, setMcpSegment] = useState(
    initialRoute?.section === "mcp"
      ? (initialRoute.segment ?? DEFAULT_MCP_SEGMENT)
      : DEFAULT_MCP_SEGMENT,
  )
  const [skillSegment, setSkillSegment] = useState(
    initialRoute?.section === "skills"
      ? (initialRoute.segment ?? DEFAULT_SKILL_SEGMENT)
      : DEFAULT_SKILL_SEGMENT,
  )

  /** 段路由的唯一入口：卡定位、select 事件与页头按钮都走这里。 */
  const applyRoute = useCallback((route: ExtensionCardRoute | null) => {
    if (!route) return
    setSection(route.section)
    const segment = route.segment
    if (!segment) return
    if (route.section === "mcp" && SEGMENT_KEYS.mcp?.includes(segment)) setMcpSegment(segment)
    if (route.section === "skills" && SEGMENT_KEYS.skills?.includes(segment)) setSkillSegment(segment)
  }, [])

  // 冷启动目标卡冻结在首帧：wrapper 挂载时会消费 flash-bus，父级随后重渲染拿到的
  // initialCardKey 会变 undefined，直接依赖该 prop 会让重播被 cleanup 提前清掉。
  const initialCardKeyRef = useRef(initialCardKey)

  // 1. 冷启动：initialCardKey 已在首帧决定段，这里把定位请求重新广播一次，
  //    让 SystemLeafWrapper 在目标卡真正挂载后重开一轮重试（它早先那轮随首次提交已经耗尽）。
  useEffect(() => {
    const cardKey = initialCardKeyRef.current
    if (!cardKey || !routeForCard(cardKey)) return
    // 放到下一个宏任务：保证 SystemLeafWrapper 的事件监听已注册（子 effect 先于父 effect 执行）
    const timer = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("aichat:settings-flash-card", {
          detail: { leafKey: "extensions", cardKey, hostId },
        }),
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [hostId])

  // 2. 已挂载时宿主热更新定位请求。hostId 必须精确匹配：Dialog 与路由页可能同时挂载本页，
  //    不过滤会让弹窗里的搜索切走背景页的段。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ leafKey?: string; cardKey?: string; hostId?: string }>).detail
      if (!detail || detail.leafKey !== "extensions" || !detail.cardKey) return
      if (detail.hostId !== hostId) return
      applyRoute(routeForCard(detail.cardKey))
    }
    window.addEventListener("aichat:settings-flash-card", handler as EventListener)
    return () => window.removeEventListener("aichat:settings-flash-card", handler as EventListener)
  }, [applyRoute, hostId])

  // 3. 导航/搜索选中本叶时可附带目标段（旧宿主只发 key，保持当前段）。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; section?: string; segment?: string }>).detail
      if (!detail || detail.key !== "extensions" || !isExtensionSection(detail.section)) return
      applyRoute({ section: detail.section, segment: detail.segment })
    }
    window.addEventListener("aichat:system-settings-select", handler as EventListener)
    return () => window.removeEventListener("aichat:system-settings-select", handler as EventListener)
  }, [applyRoute])

  // 4. 段内组件（总览入口等）请求切段。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ExtensionSectionEventDetail>).detail
      if (!detail || !isExtensionSection(detail.section)) return
      applyRoute({ section: detail.section, segment: detail.segment })
    }
    window.addEventListener(EXTENSION_SECTION_EVENT, handler as EventListener)
    return () => window.removeEventListener(EXTENSION_SECTION_EVENT, handler as EventListener)
  }, [applyRoute])

  const activeMeta = EXTENSION_SECTIONS.find((item) => item.key === section) ?? EXTENSION_SECTIONS[0]
  const segments =
    section === "mcp" ? EXTENSION_SEGMENTS.mcp : section === "skills" ? EXTENSION_SEGMENTS.skills : []
  const activeSegment =
    section === "mcp" ? mcpSegment : section === "skills" ? skillSegment : undefined

  return (
    <div className="space-y-5" data-section={section} data-segment={activeSegment}>
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-border/60">
        <div className="flex items-start gap-3">
          <Layers className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">能力扩展</h1>
            <p className="text-sm text-muted-foreground text-pretty">
              MCP 服务、Skill、内置工具与对话增强的统一入口
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyRoute({ section: "mcp", segment: DEFAULT_MCP_SEGMENT })}
          >
            新增 MCP 服务
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyRoute({ section: "skills", segment: DEFAULT_SKILL_SEGMENT })}
          >
            从 GitHub 安装 Skill
          </Button>
        </div>
      </div>

      <div className="md:flex md:gap-5">
        <SectionRail
          items={EXTENSION_SECTIONS}
          active={section}
          onChange={setSection}
          ariaLabel="能力扩展分段导航"
        />

        <div className="min-w-0 flex-1 space-y-3 mt-3 md:mt-0">
          {activeSegment !== undefined && (
            <SegmentedTabs
              items={segments}
              active={activeSegment}
              onChange={section === "mcp" ? setMcpSegment : setSkillSegment}
              ariaLabel={`${activeMeta.label}次级标签`}
            />
          )}

          <div
            data-section-panel={section}
            // 总览是卡片堆叠，不需要占位面板的浅底色；其余段保持占位外观不动
            className={cn(section !== "overview" && "v2-panel-soft p-4 space-y-1")}
          >
            {section === "overview" ? (
              <OverviewSection
                onNavigate={(nextSection, segment) => applyRoute({ section: nextSection, segment })}
              />
            ) : (
              <>
                <p className="text-sm font-medium">{activeMeta.label}</p>
                <p className="text-sm text-muted-foreground">{activeMeta.description}</p>
                <p className="text-xs text-muted-foreground">该段内容将在后续任务接入</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
