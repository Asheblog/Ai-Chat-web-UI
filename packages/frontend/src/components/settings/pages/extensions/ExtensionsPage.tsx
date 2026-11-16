"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getExtensionSection } from "../../extensions-navigation"
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

const DEFAULT_MCP_SEGMENT: McpSegment = "installations"
const DEFAULT_SKILL_SEGMENT: SkillSegment = "install"

/** 旧叶子 key（总览）：注册表未传 leafKey 时的默认值，冷启动重播与事件匹配都按它算。 */
const DEFAULT_LEAF_KEY = "extensions"

export interface ExtensionsPageProps {
  /** 渲染宿主（"dialog" / "layout"）：卡定位请求按它隔离，弹窗与路由页互不干扰 */
  hostId?: string
  /** 当前叶子 key：五个扩展子页共用本组件，定位事件用它回放，不写死 "extensions" */
  leafKey?: string
  /** 受控段：设置侧栏选中哪个叶子就渲染哪段；不传则退回内部状态（独立渲染/测试） */
  section?: ExtensionSection
  /** 用户在本页发起切段时回调，宿主据此换叶子（侧栏高亮与面包屑随之一致） */
  onSectionChange?: (section: ExtensionSection) => void
  /** 冷启动目标卡：由 renderSystemLeaf 在渲染期读取 flash-bus 后传入（页面挂载前请求已被 wrapper 消费） */
  initialCardKey?: string
}

/**
 * 能力扩展：MCP 服务 / Skill / 内置工具 / 对话增强的统一入口。
 *
 * 本页只做段路由与卡定位（flash-bus + window 事件），段导航归设置侧栏：段由 section prop
 * 受控，用户切段经 onSectionChange 交还宿主；MCP / Skill 段的次级标签状态仍由本页持有，
 * 卡定位才能先切段再滚动。
 *
 * 段级 keep-alive：访问过的段只增不减地留在 DOM 里，非当前段用原生 hidden 藏起来。
 * 旧实现按段三元渲染、切段即卸载，Skill 绑定草稿、Python 卡参数与乱斗/标题总结的输入
 * 会被回滚，Skill 段每次回来还要重发三路请求；改成常驻后切回来即原样恢复。
 */
export function ExtensionsPage({
  hostId,
  leafKey = DEFAULT_LEAF_KEY,
  section,
  onSectionChange,
  initialCardKey,
}: ExtensionsPageProps): JSX.Element {
  // 冷启动首次渲染就必须落在目标段/次级标签上，否则卡元素根本不会挂载，wrapper 的重试必然落空。
  // 卡片深链优先于 section prop：宿主先按旧叶子渲染、随后才同步叶子时不会先闪一帧总览。
  const initialRoute = initialCardKey ? routeForCard(initialCardKey) : null
  const [activeSection, setActiveSection] = useState<ExtensionSection>(
    () => initialRoute?.section ?? section ?? "overview",
  )
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
    () => new Set<ExtensionSection>(["overview", initialRoute?.section ?? section ?? "overview"]),
  )

  // 回调放在 ref 里：applyRoute 必须保持稳定（事件监听不重挂），又不能用旧闭包通知宿主。
  const onSectionChangeRef = useRef(onSectionChange)
  onSectionChangeRef.current = onSectionChange

  /** 段路由的唯一入口：卡定位、总览入口与宿主切叶子都走这里。 */
  const applyRoute = useCallback((route: ExtensionCardRoute | null) => {
    if (!route) return
    setActiveSection(route.section)
    setVisited((prev) => (prev.has(route.section) ? prev : new Set(prev).add(route.section)))
    const segment = route.segment
    if (!segment) return
    if (route.section === "mcp" && isMcpSegment(segment)) setMcpSegment(segment)
    if (route.section === "skills" && isSkillSegment(segment)) setSkillSegment(segment)
  }, [])

  /**
   * 用户意图切段：先本地应用再通知宿主。宿主回写 prop 前界面已经切过去，
   * 宿主不收（无监听）时页面仍然可用；两者幂等，重复应用不会重置段内草稿。
   */
  const navigate = useCallback(
    (nextSection: ExtensionSection, segment?: string) => {
      applyRoute({ section: nextSection, segment })
      onSectionChangeRef.current?.(nextSection)
    },
    [applyRoute],
  )

  // 宿主切叶子：只在 prop 真的变化时应用，首帧不覆盖 initialCardKey 的深链落点。
  const syncedPropRef = useRef(section)
  useEffect(() => {
    if (section === undefined) return
    if (syncedPropRef.current === section) return
    syncedPropRef.current = section
    applyRoute({ section })
  }, [section, applyRoute])

  // 冷启动目标卡冻结在首帧：wrapper 挂载时会消费 flash-bus，父级随后重渲染拿到的
  // initialCardKey 会变 undefined，直接依赖该 prop 会让重播被 cleanup 提前清掉。
  const initialCardKeyRef = useRef(initialCardKey)
  const replayedRef = useRef(false)

  // 1. 冷启动：initialCardKey 已在首帧决定段，这里把定位请求按当前 leafKey 重新广播一次，
  //    让 SystemLeafWrapper 在目标卡真正挂载后重开一轮重试（它早先那轮随首次提交已经耗尽）。
  useEffect(() => {
    const cardKey = initialCardKeyRef.current
    if (!cardKey || !routeForCard(cardKey) || replayedRef.current) return
    replayedRef.current = true
    // 放到下一个宏任务：保证 SystemLeafWrapper 的事件监听已注册（子 effect 先于父 effect 执行）
    const timer = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("aichat:settings-flash-card", {
          detail: { leafKey, cardKey, hostId },
        }),
      )
    }, 0)
    return () => window.clearTimeout(timer)
  }, [hostId, leafKey])

  // 2. 已挂载时宿主热更新定位请求。hostId 必须精确匹配：Dialog 与路由页可能同时挂载本页，
  //    不过滤会让弹窗里的搜索切走背景页的段。leafKey 只需属于扩展组：宿主先切叶子再发事件，
  //    本组件的 leafKey prop 可能还没同步，写死某个叶子会漏掉刚切过来的定位请求。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ leafKey?: string; cardKey?: string; hostId?: string }>).detail
      if (!detail || !detail.cardKey) return
      if (detail.hostId !== hostId) return
      if (!getExtensionSection(detail.leafKey ?? "")) return
      applyRoute(routeForCard(detail.cardKey))
    }
    window.addEventListener("aichat:settings-flash-card", handler as EventListener)
    return () => window.removeEventListener("aichat:settings-flash-card", handler as EventListener)
  }, [applyRoute, hostId])

  const activeSegment =
    activeSection === "mcp" ? mcpSegment : activeSection === "skills" ? skillSegment : undefined

  /** 段内容：key 决定组件，切换段时已挂载的段只是被 hidden 藏起来，不重建。 */
  const renderSectionBody = (key: ExtensionSection, isActive: boolean): JSX.Element => {
    if (key === "mcp") {
      return (
        <McpSection segment={mcpSegment} onSegmentChange={setMcpSegment} active={isActive} />
      )
    }
    if (key === "skills") {
      return (
        <SkillSection segment={skillSegment} onSegmentChange={setSkillSegment} active={isActive} />
      )
    }
    if (key === "tools") return <ToolsSection active={isActive} />
    if (key === "extra") return <ExtraSection active={isActive} />
    return <OverviewSection onNavigate={navigate} active={isActive} />
  }

  return (
    <div className="space-y-4" data-section={activeSection} data-segment={activeSegment}>
      {EXTENSION_SECTIONS.map((item) => {
        // 未访问过的段不渲染：不提前发请求，也不占 DOM
        if (!visited.has(item.key)) return null
        const isActive = item.key === activeSection
        return (
          <div
            key={item.key}
            data-section-panel={item.key}
            hidden={!isActive}
            className={isActive ? "space-y-4" : ""}
          >
            {renderSectionBody(item.key, isActive)}
          </div>
        )
      })}
    </div>
  )
}
