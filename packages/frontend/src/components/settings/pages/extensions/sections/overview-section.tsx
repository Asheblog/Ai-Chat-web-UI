"use client"

import { useEffect, useState } from "react"
import { ArrowRight, Link2, Puzzle, Terminal } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { listConnections } from "@/features/mcp/api"
import { listSkillApprovals } from "@/features/skills/api"
import { useSystemSettings } from "@/hooks/use-system-settings"
import type { ApiResponse } from "@/types"
import type { ExtensionSection } from "../extensions-sections"

/**
 * 能力扩展 · 总览段：三类能力的只读状态卡 + 待处理清单 + 两个对话增强入口。
 * 总开关各归其段，本组件刻意不放 Switch；三路数据并发拉取，任一路失败只把对应行降级为「未知」。
 */

type CountState = { status: "loading" | "ready" | "error"; value: number }

const COUNT_LOADING: CountState = { status: "loading", value: 0 }

/** 状态配色沿用 globals.css 的 --success / --warning 语义色，不新造配色。 */
const TONE_ON = "border-[hsl(var(--success)/0.25)] bg-[hsl(var(--success)/0.11)] text-[hsl(var(--success))]"
const TONE_TODO = "border-[hsl(var(--warning)/0.26)] bg-[hsl(var(--warning)/0.11)] text-[hsl(var(--warning))]"
const TONE_IDLE = "border-border bg-muted/60 text-muted-foreground"

/** 从 ApiResponse 信封取数组：请求失败或信封里没有数组都算未知，不静默当 0。 */
function readList<T>(result: PromiseSettledResult<ApiResponse<T[]>>): T[] | null {
  if (result.status !== "fulfilled") return null
  return Array.isArray(result.value?.data) ? result.value.data : null
}

function countState(items: readonly unknown[] | null): CountState {
  return items ? { status: "ready", value: items.length } : { status: "error", value: 0 }
}

/** 卡片副信息：加载中给 null（骨架），失败给「— 单位」，0 可换白话说法。 */
function metaText(count: CountState, unit: string, zeroText?: string): string | null {
  if (count.status === "loading") return null
  if (count.status === "error") return `— ${unit}`
  if (count.value === 0 && zeroText) return zeroText
  return `${count.value} ${unit}`
}

/** 待处理行文案：数量嵌在句子里，失败时退回不带数字的说法。 */
function rowText(count: CountState, unit: string, zeroText: string, unknownText: string): string {
  if (count.status !== "ready") return unknownText
  return count.value === 0 ? zeroText : `${count.value} ${unit}`
}

type FlagStatus = { label: string; tone: string } | null

/** 总开关状态徽标；null 表示设置还在加载（渲染骨架）。 */
function flagStatus(
  loading: boolean,
  unknown: boolean,
  enabled: boolean,
  onLabel: string,
  offLabel: string,
): FlagStatus {
  if (loading) return null
  if (unknown) return { label: "状态未知", tone: TONE_IDLE }
  return enabled ? { label: onLabel, tone: TONE_ON } : { label: offLabel, tone: TONE_IDLE }
}

type PendingStatus =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; label: string; tone: string; actionable: boolean }

function pendingStatus(count: CountState): PendingStatus {
  if (count.status === "loading") return { state: "loading" }
  if (count.status === "error") return { state: "error" }
  return count.value > 0
    ? { state: "ready", label: "待处理", tone: TONE_TODO, actionable: true }
    : { state: "ready", label: "已就绪", tone: TONE_IDLE, actionable: false }
}

type CapabilityCardProps = {
  icon: LucideIcon
  title: string
  description: string
  /** 补充说明（如 MCP 的五步配置流程），可选 */
  hint?: string
  /** null = 设置加载中 */
  status: FlagStatus
  /** undefined = 本卡无副信息；null = 统计加载中 */
  meta?: string | null
  onEnter: () => void
}

function CapabilityCard({
  icon: Icon,
  title,
  description,
  hint,
  status,
  meta,
  onEnter,
}: CapabilityCardProps) {
  return (
    <section className="v2-panel flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        </div>
        {status ? (
          <Badge className={status.tone}>{status.label}</Badge>
        ) : (
          <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
        )}
      </div>

      <p className="text-sm text-muted-foreground text-pretty">{description}</p>
      {hint ? <p className="v2-muted-line text-xs">{hint}</p> : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        {meta === undefined ? null : meta === null ? (
          <Skeleton className="h-3.5 w-16" />
        ) : (
          <span className="v2-muted-line">{meta}</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="ml-auto gap-1"
          onClick={onEnter}
          aria-label={`进入 ${title}`}
        >
          进入
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </section>
  )
}

function PendingRow({
  text,
  status,
  onHandle,
}: {
  text: string
  status: PendingStatus
  onHandle: () => void
}) {
  const actionable = status.state === "ready" && status.actionable

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-3 last:border-b-0">
      <span className="text-sm font-medium text-foreground">{text}</span>
      {status.state === "loading" ? (
        <Skeleton className="h-5 w-12 rounded-full" />
      ) : status.state === "error" ? (
        <Badge className={TONE_IDLE}>—</Badge>
      ) : (
        <Badge className={status.tone}>{status.label}</Badge>
      )}
      <span className="ml-auto flex items-center gap-2">
        {status.state === "error" ? <span className="v2-muted-line">状态未知</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="gap-1"
          onClick={onHandle}
          disabled={!actionable}
          aria-label={`${text}：去处理`}
        >
          去处理
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </span>
    </li>
  )
}

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
