"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Package, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { listConnections } from "@/features/mcp/api"
import { listSkillApprovals } from "@/features/skills/api"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { sectionMeta, type ExtensionSection } from "../extensions-sections"
import {
  CapabilityRow,
  PendingEmpty,
  PendingRow,
  countState,
  flagStatus,
  metaText,
  readList,
  type CountState,
} from "./overview-cards"
import { SectionPageTitle } from "./section-frame"
import { SectionSwitch } from "./section-switch"

/**
 * 能力扩展 · 总览段：本段的页标题 + AI 自助安装块 + 四类能力紧凑列表 + 待办。
 *
 * 页标题与 AI 安装块只属于总览：MCP / Skill / 内置工具 / 对话增强 各自在段内渲染页标题，
 * 所以这里不是「所有页共用的页头」，切段后不会重复出现。
 *
 * 三路数据（系统设置 / Skill 待审批 / MCP 连接）并发拉取，任一路失败只把对应行降级为「未知」。
 * 待办只渲染真实项：两路都就绪且为 0 时收敛成一条空态，不逐条写「没有…」的零态行。
 */

const COUNT_LOADING: CountState = { status: "loading", value: 0 }

export function OverviewSection({
  onNavigate,
  active = true,
}: {
  onNavigate: (section: ExtensionSection, segment?: string) => void
  /** 本段是否为当前段：keep-alive 下其余段 hidden，主标题降为 h2 */
  active?: boolean
}): JSX.Element {
  const { settings, refresh } = useSystemSettings()
  const [settingsFetchDone, setSettingsFetchDone] = useState(false)
  const [approvals, setApprovals] = useState<CountState>(COUNT_LOADING)
  const [connections, setConnections] = useState<CountState>(COUNT_LOADING)
  const [unboundConnections, setUnboundConnections] = useState<CountState>(COUNT_LOADING)

  // 进入总览时设置可能还没被任何页面拉过：补一次，失败只降级为「状态未知」。
  useEffect(() => {
    if (settings !== null || settingsFetchDone) return
    let cancelled = false
    void refresh()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSettingsFetchDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [settings, settingsFetchDone, refresh])

  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      listSkillApprovals({ status: "pending", limit: 100 }),
      listConnections(),
    ]).then(([approvalResult, connectionResult]) => {
      if (cancelled) return
      const connectionItems = readList(connectionResult)
      setApprovals(countState(readList(approvalResult)))
      setConnections(countState(connectionItems))
      setUnboundConnections(
        countState(connectionItems ? connectionItems.filter((item) => item.secretVaultId == null) : null),
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  const settingsLoading = settings === null && !settingsFetchDone
  const settingsUnknown = settings === null && settingsFetchDone
  const pendingApprovals = approvals.status === "ready" ? approvals.value : 0
  const unboundCount = unboundConnections.status === "ready" ? unboundConnections.value : 0
  // 未绑定凭据只是信息：连接可以不挂凭据（McpConnection 没有 requiresAuth 字段），
  // 不能据此断言「需要处理」，也不能反过来说「无需处理」。
  const showCredentialHint = unboundConnections.status === "error" || unboundCount > 0

  return (
    <div className="space-y-4">
      <SectionPageTitle
        title="工具与扩展"
        description={sectionMeta("overview").description}
        active={active}
      />

      <section
        aria-label="AI 自助安装"
        className="rounded-xl border border-border bg-surface-subtle px-4 py-3"
      >
        {/* 手机：标题与开关同行、说明独占一行（不被状态词挤）、按钮全宽；md：标题+说明一行、按钮一行 */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 md:justify-start">
          <span className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
            <span className="text-sm font-semibold text-foreground">AI 自助安装</span>
          </span>
          <p className="order-last basis-full text-sm text-muted-foreground text-pretty md:order-none md:basis-auto">
            在聊天中粘贴 GitHub 链接即可安装扩展
          </p>
          <span className="shrink-0 md:ml-auto">
            <SectionSwitch
              settingsKey="extensionInstallToolEnable"
              label=""
              onLabel="已开启"
              offLabel="已关闭"
              ariaLabel="允许模型在聊天里按仓库链接安装扩展"
            />
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 w-full gap-1.5 md:min-h-0 md:w-auto"
            onClick={() => onNavigate("mcp", "installations")}
          >
            <Package className="h-3.5 w-3.5" aria-hidden="true" />
            MCP 安装模板
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 w-full gap-1.5 md:min-h-0 md:w-auto"
            onClick={() => onNavigate("skills", "install")}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            从 GitHub 安装 Skill
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">能力管理</h2>
        <ul className="v2-panel divide-y divide-border overflow-hidden">
          <li>
            <CapabilityRow
              icon={sectionMeta("mcp").icon}
              title={sectionMeta("mcp").label}
              description={sectionMeta("mcp").summary}
              status={flagStatus(
                settingsLoading,
                settingsUnknown,
                settings?.mcpGlobalEnabled ?? true,
                "已启用",
                "已关闭",
              )}
              meta={metaText(connections, "个连接")}
              onEnter={() => onNavigate("mcp")}
            />
          </li>
          <li>
            <CapabilityRow
              icon={sectionMeta("skills").icon}
              title={sectionMeta("skills").label}
              description={sectionMeta("skills").summary}
              status={flagStatus(
                settingsLoading,
                settingsUnknown,
                settings?.chatDynamicSkillRuntimeEnabled ?? false,
                "运行时已开",
                "运行时未开",
              )}
              meta={metaText(approvals, "条待审批", "无待审批")}
              onEnter={() => onNavigate("skills", pendingApprovals > 0 ? "approvals" : "versions")}
            />
          </li>
          <li>
            <CapabilityRow
              icon={sectionMeta("tools").icon}
              title={sectionMeta("tools").label}
              description={sectionMeta("tools").summary}
              status={flagStatus(
                settingsLoading,
                settingsUnknown,
                settings?.pythonToolEnable ?? false,
                "已启用",
                "已关闭",
              )}
              meta="Python"
              onEnter={() => onNavigate("tools")}
            />
          </li>
          <li>
            <CapabilityRow
              icon={sectionMeta("extra").icon}
              title={sectionMeta("extra").label}
              description={sectionMeta("extra").summary}
              meta="2 项设置"
              onEnter={() => onNavigate("extra")}
            />
          </li>
        </ul>
      </section>

      <section className="v2-panel" aria-label="待办">
        {approvals.status === "loading" ? (
          <div className="space-y-2 px-4 py-4" aria-busy="true">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : approvals.status === "error" ? (
          <ul>
            <PendingRow
              text="Skill 调用待审批"
              state="error"
              onHandle={() => onNavigate("skills", "approvals")}
            />
          </ul>
        ) : approvals.value === 0 ? (
          <PendingEmpty />
        ) : (
          <ul>
            <PendingRow
              text={`${approvals.value} 条 Skill 调用待审批`}
              state="ready"
              onHandle={() => onNavigate("skills", "approvals")}
            />
          </ul>
        )}

        {showCredentialHint ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-3">
            <span className="min-w-0 flex-1 text-[13px] text-muted-foreground text-pretty">
              {unboundConnections.status === "error"
                ? "MCP 连接的凭据绑定情况暂时读不到。"
                : `另有 ${unboundCount} 个 MCP 连接尚未绑定凭据；不需要鉴权的连接可以留空。`}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="min-h-11 gap-1 md:min-h-0"
              onClick={() => onNavigate("mcp", "connections")}
            >
              查看连接
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
