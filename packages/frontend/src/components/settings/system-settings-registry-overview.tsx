"use client"

import {
  ArrowRight,
  Cable,
  Database,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemConnections } from "@/components/settings/system-connections/use-system-connections"
import { useSystemModels } from "@/components/settings/system-models/use-system-models"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { cn } from "@/lib/utils"

type OverviewCard = {
  label: string
  value: string
  tone: string
  icon: LucideIcon
}

const overviewCards: OverviewCard[] = [
  {
    label: "模型与连接",
    value: "供应商与连接 / 模型管理",
    tone: "text-blue-600",
    icon: Cable,
  },
  {
    label: "功能与工具",
    value: "搜索与知识库 / 工具与扩展 / MCP",
    tone: "text-emerald-600",
    icon: Wrench,
  },
  {
    label: "成员与安全",
    value: "用户与注册 / Skill 治理",
    tone: "text-violet-600",
    icon: ShieldCheck,
  },
  {
    label: "系统与数据",
    value: "品牌与界面 / 日志与审计 / 数据与维护",
    tone: "text-amber-600",
    icon: Database,
  },
]

type ChecklistTarget = "connections" | "users-registration" | "search-knowledge" | "models"

type ChecklistItem = {
  key: ChecklistTarget
  label: string
  done: boolean
}

export function SystemOverviewContent() {
  const { settings } = useSystemSettings()
  const { connections } = useSystemConnections()
  const { list: modelList } = useSystemModels()

  const loading = settings === null

  const checklist: ChecklistItem[] = [
    { key: "connections", label: "模型接入", done: connections.length > 0 },
    { key: "users-registration", label: "注册开放", done: settings?.allowRegistration === true },
    { key: "search-knowledge", label: "搜索配置", done: settings?.webSearchAgentEnable === true },
    { key: "models", label: "默认模型", done: modelList.length > 0 },
  ]

  const goTo = (key: ChecklistTarget) => {
    window.dispatchEvent(new CustomEvent("aichat:system-settings-select", { detail: { key } }))
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {overviewCards.map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="v2-panel p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Icon className={cn("h-4 w-4 shrink-0", card.tone)} />
                {card.label}
              </div>
              <div className={cn("mt-3 text-lg font-semibold", card.tone)}>{card.value}</div>
            </div>
          )
        })}
      </div>

      <div className="v2-panel p-5">
        <div className="text-base font-semibold">待你完成</div>
        {loading ? (
          <div data-testid="overview-checklist-skeleton" className="mt-4 space-y-4">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-7 w-20 rounded-md" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="mt-2">
            {checklist.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between gap-3 border-b border-border/60 py-3 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{item.label}</span>
                  <Badge
                    className={
                      item.done
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                        : "border-border bg-muted/60 text-muted-foreground"
                    }
                  >
                    {item.done ? "已完成" : "待完成"}
                  </Badge>
                </div>
                <button
                  type="button"
                  onClick={() => goTo(item.key)}
                  aria-label={`去配置：${item.label}`}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  去配置
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="v2-panel-soft p-4 text-sm text-muted-foreground">
        完成以上即可正常使用，其余参数保持默认。
      </div>
    </div>
  )
}
