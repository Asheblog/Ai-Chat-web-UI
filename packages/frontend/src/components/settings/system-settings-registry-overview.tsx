"use client"

import { ArrowRight, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemConnections } from "@/components/settings/system-connections/use-system-connections"
import { useSystemModels } from "@/components/settings/system-models/use-system-models"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { cn } from "@/lib/utils"
import { systemSettingsTree, type SystemSettingsEntry } from "./system-settings-tree"

type StatusRow = {
  /** 跳转目标叶子 key */
  target: string
  label: string
  value: string
  note: string
  tone?: string
}

/** 导航树除概览外的 6 组入口（概览自己不再递归列出）。 */
const entryGroups = systemSettingsTree.filter((entry) => entry.key !== "overview")

const leavesOf = (entry: SystemSettingsEntry) => ("children" in entry ? entry.children : [entry])
const firstLeafKeyOf = (entry: SystemSettingsEntry) => leavesOf(entry)[0]?.key ?? entry.key

const goTo = (key: string) => {
  window.dispatchEvent(new CustomEvent("aichat:system-settings-select", { detail: { key } }))
}

/**
 * 系统设置入口：只陈述当前配置的事实状态 + 6 组入口。
 *
 * 这里刻意不做「完成度 / 待办清单」：私有部署、离线部署、关闭注册都是完整可用的形态，
 * 注册开放与否、搜索是否开启属于访问策略与可选能力，不是未完成项；
 * 连接列表与模型列表非空同样只说明「配置存在」，不代表连接可用或已经选好默认项。
 */
export function SystemOverviewContent() {
  const { settings, refresh, error, isLoading } = useSystemSettings()
  const { connections, loading: connectionsLoading, error: connectionsError } = useSystemConnections()
  const { list: modelList, isLoading: modelsLoading } = useSystemModels()

  const settingsPending = settings === null && isLoading && !error
  // 未取到设置时既不猜值也不空白：加载中说「读取中」，失败说「—」（失败原因在顶部错误块里给）。
  const value = (resolved: string) => {
    if (settings !== null) return resolved
    return settingsPending ? "读取中…" : "—"
  }

  const connectionValue = connectionsLoading
    ? "读取中…"
    : connectionsError
      ? connectionsError
      : connections.length > 0
        ? `已配置 ${connections.length} 个连接`
        : "尚未配置连接"

  const enabledEngines = (settings?.webSearchEnabledEngines ?? []).filter(Boolean)
  const searchValue = settings?.webSearchAgentEnable
    ? enabledEngines.length > 0
      ? `已开启 · ${enabledEngines.join(" / ")}`
      : "已开启"
    : "未开启"

  const rows: StatusRow[] = [
    {
      target: "connections",
      label: "模型连接",
      value: connectionValue,
      note: "连接是否可用以连接页的凭据检测结果为准；本页只反映已保存的配置。",
      tone: connectionsError ? "text-destructive" : undefined,
    },
    {
      target: "models",
      label: "可用模型",
      value: modelsLoading
        ? "读取中…"
        : modelList.length > 0
          ? `已收录 ${modelList.length} 个模型`
          : "尚未收录模型",
      note: "能力与生成参数按模型分别设置；列表存在不代表已经选好默认项。",
    },
    {
      target: "search-knowledge",
      label: "联网搜索",
      value: value(searchValue),
      note: "不联网的部署同样完整可用；搜索是可选能力，引擎与密钥在搜索页配置。",
    },
    {
      target: "users-registration",
      label: "注册与访问",
      value: value(settings?.allowRegistration ? "开放注册" : "仅管理员创建账号"),
      note: "关闭注册通常是私有部署的预期状态，不计为未完成。",
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">概览</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            当前部署的状态摘要与设置入口
          </p>
        </div>
      </div>

      {error && settings === null ? (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <p className="font-medium text-destructive">系统设置读取失败</p>
            <p className="mt-1 text-ink-secondary">{error}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void refresh().catch(() => {})}>
            重新加载
          </Button>
        </div>
      ) : null}

      <section className="v2-panel p-5" aria-labelledby="overview-status-title">
        <h2 id="overview-status-title" className="text-base font-semibold">
          部署状态
        </h2>
        {settingsPending ? (
          <div data-testid="overview-status-skeleton" className="mt-4 space-y-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-7 w-16 rounded-md" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="mt-2">
            {rows.map((row) => (
              <li
                key={row.target}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-sm font-medium">{row.label}</span>
                    <span className={cn("text-sm text-ink-secondary", row.tone)}>{row.value}</span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-tertiary">{row.note}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => goTo(row.target)}
                  aria-label={`打开${row.label}`}
                >
                  打开
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="overview-groups-title" className="space-y-3">
        <h2 id="overview-groups-title" className="text-base font-semibold">
          按分组进入
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {entryGroups.map((group) => {
            const Icon = group.icon
            const leaves = leavesOf(group)
            return (
              <div key={group.key} className="v2-panel flex flex-col gap-2 p-4">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-ink-tertiary" aria-hidden="true" />
                  <span className="text-sm font-medium">{group.label}</span>
                </div>
                <p className="text-[12.5px] leading-relaxed text-ink-tertiary">
                  {group.summary ?? leaves.map((leaf) => leaf.label).join(" / ")}
                </p>
                {leaves.length > 1 ? (
                  <p className="text-[11.5px] leading-relaxed text-ink-tertiary">
                    {leaves.map((leaf) => leaf.label).join(" / ")}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-auto self-start"
                  onClick={() => goTo(firstLeafKeyOf(group))}
                  aria-label={`打开${group.label}`}
                >
                  进入
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            )
          })}
        </div>
      </section>

      <div className="v2-panel-soft p-4 text-sm text-muted-foreground">
        状态只反映当前配置，不代表可用性检测结果；其余参数保持默认即可，需要时在对应分组里调整。
      </div>
    </div>
  )
}
