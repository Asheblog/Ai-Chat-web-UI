"use client"

import type { ReactNode } from "react"
import { AlertTriangle, CheckCircle2, Filter, Loader2, PlugZap, Plus, RefreshCw, Search, Server, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { HEALTH_FILTERS, STATUS_FILTERS } from "./view-model"

type ProviderOption = {
  key: string
  label: string
  count: number
  keyCount: number
}

export type ConnectionStats = {
  totalGroups: number
  totalKeys: number
  enabledKeys: number
  healthy: number
  warning: number
  errorCount: number
}

type SystemConnectionsToolbarProps = {
  stats: ConnectionStats
  providers: ProviderOption[]
  loading: boolean
  query: string
  providerFilter: string
  statusFilter: string
  healthFilter: string
  onQueryChange: (value: string) => void
  onProviderFilterChange: (value: string) => void
  onStatusFilterChange: (value: string) => void
  onHealthFilterChange: (value: string) => void
  onRefresh: () => void
  onCreate: () => void
}

export function SystemConnectionsToolbar({
  stats,
  providers,
  loading,
  query,
  providerFilter,
  statusFilter,
  healthFilter,
  onQueryChange,
  onProviderFilterChange,
  onStatusFilterChange,
  onHealthFilterChange,
  onRefresh,
  onCreate,
}: SystemConnectionsToolbarProps) {
  return (
    <section className="v2-panel overflow-hidden bg-background/92 shadow-none">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">连接管理</h2>
            <span className="v2-status">{stats.totalGroups} 个端点组</span>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            列表默认收起，只展示运行状态和关键摘要；点击连接行可展开 Key 池、验证结果和高级配置。
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="outline" onClick={onRefresh} disabled={loading} className="h-10 bg-background">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
          <Button onClick={onCreate} className="h-10">
            <Plus className="mr-2 h-4 w-4" />
            新增连接
          </Button>
        </div>
      </div>

      <div className="grid gap-0 border-y border-border sm:grid-cols-2 xl:grid-cols-4">
        <ConnectionStat icon={<PlugZap className="h-4 w-4" />} label="Key 总数" value={stats.totalKeys} />
        <ConnectionStat icon={<CheckCircle2 className="h-4 w-4" />} label="启用 Key" value={stats.enabledKeys} tone="success" />
        <ConnectionStat icon={<CheckCircle2 className="h-4 w-4" />} label="健康端点" value={stats.healthy} tone="success" />
        <ConnectionStat
          icon={stats.errorCount > 0 ? <X className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          label="需处理"
          value={stats.warning + stats.errorCount}
          tone={stats.errorCount > 0 ? "danger" : stats.warning > 0 ? "warning" : "neutral"}
        />
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <ProviderChip
            active={providerFilter === "all"}
            label="全部"
            count={stats.totalGroups}
            onClick={() => onProviderFilterChange("all")}
          />
          {providers.map((provider) => (
            <ProviderChip
              key={provider.key}
              active={providerFilter === provider.key}
              label={provider.label}
              count={provider.count}
              onClick={() => onProviderFilterChange(provider.key)}
            />
          ))}
        </div>

        <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_160px_160px]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索名称、端点、标签或 Key"
              className="h-10 bg-background pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="h-10 bg-background">
              <Filter className="mr-2 h-4 w-4 text-muted-foreground/70" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={healthFilter} onValueChange={onHealthFilterChange}>
            <SelectTrigger className="h-10 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HEALTH_FILTERS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </section>
  )
}

function ConnectionStat({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode
  label: string
  value: number
  tone?: "neutral" | "success" | "warning" | "danger"
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-600 bg-emerald-50"
      : tone === "warning"
        ? "text-amber-600 bg-amber-50"
        : tone === "danger"
          ? "text-red-600 bg-red-50"
          : "text-blue-600 bg-blue-50"

  return (
    <div className="flex min-h-[76px] items-center gap-3 border-b border-border/70 px-4 py-3 last:border-b-0 sm:odd:border-r xl:border-b-0 xl:border-r xl:last:border-r-0 xl:px-5">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]", toneClass)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-lg font-semibold text-foreground">{value}</div>
      </div>
    </div>
  )
}

function ProviderChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[8px] border px-3 text-sm transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background/80 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Server className="h-4 w-4" />
      <span>{label}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
    </button>
  )
}
