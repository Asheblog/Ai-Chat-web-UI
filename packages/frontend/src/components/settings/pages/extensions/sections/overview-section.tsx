"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Link2, Puzzle, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { listConnections } from "@/features/mcp/api"
import { listSkillApprovals } from "@/features/skills/api"
import { useSystemSettings } from "@/hooks/use-system-settings"
import type { ExtensionSection } from "../extensions-sections"
import {
  CapabilityCard,
  PendingRow,
  countState,
  flagStatus,
  metaText,
  pendingStatus,
  readList,
  rowText,
  type CountState,
} from "./overview-cards"

/**
 * 能力扩展 · 总览段：三类能力的只读状态卡 + 待处理清单 + 两个对话增强入口。
 * 总开关各归其段，本组件刻意不放 Switch；三路数据并发拉取，任一路失败只把对应行降级为「未知」。
 */

const COUNT_LOADING: CountState = { status: "loading", value: 0 }

export function OverviewSection({
  onNavigate,
}: {
  onNavigate: (section: ExtensionSection, segment?: string) => void
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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <CapabilityCard
          icon={Link2}
          title="MCP 服务"
          description="连接外部工具与数据源"
          hint="推荐流程：安装模板 → 连接 → 凭据 → 工具 → 绑定"
          status={flagStatus(settingsLoading, settingsUnknown, settings?.mcpGlobalEnabled ?? true, "已启用", "已关闭")}
          meta={metaText(connections, "个连接")}
          onEnter={() => onNavigate("mcp")}
        />
        <CapabilityCard
          icon={Puzzle}
          title="Skill"
          description="安装、审批与绑定第三方 Skill"
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
        <CapabilityCard
          icon={Terminal}
          title="内置工具"
          description="让模型在沙箱里执行 Python"
          status={flagStatus(settingsLoading, settingsUnknown, settings?.pythonToolEnable ?? false, "已启用", "已关闭")}
          onEnter={() => onNavigate("tools")}
        />
      </div>

      <section className="v2-panel pb-1">
        <div className="px-4 pt-4">
          <h2 className="v2-section-title">待你处理</h2>
          <p className="v2-muted-line mt-1">只列出需要动作的项，其余参数保持默认即可。</p>
        </div>
        <ul className="mt-2">
          <PendingRow
            text={rowText(approvals, "条 Skill 调用待审批", "没有待审批的调用", "Skill 调用待审批")}
            status={pendingStatus(approvals)}
            onHandle={() => onNavigate("skills", "approvals")}
          />
          <PendingRow
            text={rowText(
              unboundConnections,
              "个 MCP 连接未绑定凭据",
              "连接都已绑定凭据",
              "MCP 连接未绑定凭据",
            )}
            status={pendingStatus(unboundConnections)}
            onHandle={() => onNavigate("mcp", "connections")}
          />
        </ul>
      </section>

      <div className="v2-panel flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className="text-sm font-medium text-foreground">其他增强</span>
        <span className="v2-muted-line">模型大乱斗与标题智能总结都在「对话增强」段</span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="xs" className="gap-1" onClick={() => onNavigate("extra")}>
            模型大乱斗
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="xs" className="gap-1" onClick={() => onNavigate("extra")}>
            标题智能总结
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>
    </div>
  )
}
