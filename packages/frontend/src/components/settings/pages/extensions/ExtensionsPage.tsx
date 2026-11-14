"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionRail } from "../../components/section-rail"
import {
  EXTENSION_SECTIONS,
  routeForCard,
  type ExtensionCardRoute,
  type ExtensionSection,
} from "./extensions-sections"
import { ExtraSection } from "./sections/extra-section"
import { McpSection, isMcpSegment, type McpSegment } from "./sections/mcp-section"
import { OverviewSection } from "./sections/overview-section"
import { SkillSection, isSkillSegment, type SkillSegment } from "./sections/skill-section"
import { ToolsSection } from "./sections/tools-section"
import { SectionSwitch } from "./sections/section-switch"

const DEFAULT_MCP_SEGMENT: McpSegment = "installations"
const DEFAULT_SKILL_SEGMENT: SkillSegment = "install"

/** 页面内容区 id：移动端段标签用 aria-controls 指向它，读屏能说出标签控制哪块内容。 */
const SECTION_PANEL_ID = "extension-section-panel"

/**
 * 能力扩展：MCP 服务 / Skill / 内置工具 / 对话增强的统一入口。
 *
 * 骨架只负责段路由与卡定位（flash-bus + window 事件），5 个段各自取数、各自保存；
 * MCP / Skill 段的次级标签状态由本页持有，卡定位才能先切段再滚动。
 *
 * 段级 keep-alive：访问过的段只增不减地留在 DOM 里，非当前段用原生 hidden 藏起来。
 * 旧实现按段三元渲染、切段即卸载，Skill 绑定草稿、Python 卡参数与乱斗/标题总结的输入
 * 会被回滚，Skill 段每次回来还要重发三路请求；改成常驻后切回来即原样恢复。
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
  const [mcpSegment, setMcpSegment] = useState<McpSegment>(
    initialRoute?.section === "mcp" && isMcpSegment(initialRoute.segment)
      ? initialRoute.segment
      : DEFAULT_MCP_SEGMENT,
  )
  const [skillSegment, setSkillSegment] = useState<SkillSegment>(
    initialRoute?.section === "skills" && isSkillSegment(initialRoute.segment)
      ? initialRoute.segment
      : DEFAULT_SKILL_SEGMENT,
  )
  // 已访问过的段：总览随页面一起挂载，其余段第一次被路由到时加入，之后一直保持挂载。
  const [visited, setVisited] = useState<ReadonlySet<ExtensionSection>>(
    () => new Set<ExtensionSection>(["overview", initialRoute?.section ?? "overview"]),
  )

  /** 段路由的唯一入口：卡定位、页头按钮与段导航都走这里。 */
  const applyRoute = useCallback((route: ExtensionCardRoute | null) => {
    if (!route) return
    setSection(route.section)
    setVisited((prev) => (prev.has(route.section) ? prev : new Set(prev).add(route.section)))
    const segment = route.segment
    if (!segment) return
    if (route.section === "mcp" && isMcpSegment(segment)) setMcpSegment(segment)
    if (route.section === "skills" && isSkillSegment(segment)) setSkillSegment(segment)
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

  const activeSegment =
    section === "mcp" ? mcpSegment : section === "skills" ? skillSegment : undefined

  /** 段内容：key 决定组件，切换段时已挂载的段只是被 hidden 藏起来，不重建。 */
  const renderSectionBody = (key: ExtensionSection): JSX.Element => {
    if (key === "mcp") return <McpSection segment={mcpSegment} onSegmentChange={setMcpSegment} />
    if (key === "skills") {
      return <SkillSection segment={skillSegment} onSegmentChange={setSkillSegment} />
    }
    if (key === "tools") return <ToolsSection />
    if (key === "extra") return <ExtraSection />
    return (
      <OverviewSection
        onNavigate={(nextSection, segment) => applyRoute({ section: nextSection, segment })}
      />
    )
  }

  return (
    <div className="space-y-5" data-section={section} data-segment={activeSegment}>
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-start gap-3">
          <Layers className="mt-0.5 h-5 w-5 shrink-0 text-ink-tertiary" />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">能力扩展</h1>
            <p className="text-sm text-muted-foreground text-pretty">
              MCP 服务、Skill、内置工具与对话增强的统一入口
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SectionSwitch
            settingsKey="extensionInstallToolEnable"
            label="AI 自助安装"
            onLabel="已开启"
            offLabel="已关闭"
            ariaLabel="允许模型在聊天里按仓库链接安装扩展"
            hint="聊天里贴 GitHub 链接即可安装 MCP 服务或 Skill"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyRoute({ section: "mcp", segment: DEFAULT_MCP_SEGMENT })}
          >
            MCP 安装模板
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
          onChange={(next) => applyRoute({ section: next })}
          ariaLabel="能力扩展分段导航"
          panelId={SECTION_PANEL_ID}
        />

        <div
          id={SECTION_PANEL_ID}
          role="tabpanel"
          aria-label="能力扩展内容"
          className="min-w-0 flex-1 space-y-3 mt-3 md:mt-0"
        >
          {EXTENSION_SECTIONS.map((item) => {
            // 未访问过的段不渲染：不提前发请求，也不占 DOM
            if (!visited.has(item.key)) return null
            const isActive = item.key === section
            return (
              <div
                key={item.key}
                data-section-panel={item.key}
                hidden={!isActive}
                className={isActive ? "space-y-3" : ""}
              >
                {renderSectionBody(item.key)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
