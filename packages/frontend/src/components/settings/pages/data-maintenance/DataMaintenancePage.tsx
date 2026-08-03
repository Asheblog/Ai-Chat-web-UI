"use client"

import { useEffect } from "react"
import { HardDrive } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { RetentionPolicyCard } from "./retention-policy-card"
import { ContextCompressionCard } from "./context-compression-card"
import { ConcurrencyCard } from "./concurrency-card"
import { TaskTraceCard } from "./task-trace-card"
import { SystemLogCard } from "./system-log-card"

/**
 * 数据与维护页：页壳（单一 useSystemSettings + 共享骨架/错误重试），
 * 5 张 FeatureCard：数据保留策略 / 上下文压缩 / 并发生成控制 / 任务追踪 / 系统运行日志。
 */
export function DataMaintenancePage() {
  const {
    settings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  if (isLoading && !settings) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || "无法加载系统设置"}</p>
        <Button variant="outline" className="mt-3" onClick={() => fetchSystemSettings()}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <HardDrive className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">数据与维护</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            数据保留、压缩、并发与日志维护
          </CardDescription>
        </div>
      </div>

      <RetentionPolicyCard settings={settings} update={updateSystemSettings} />
      <ContextCompressionCard settings={settings} update={updateSystemSettings} />
      <ConcurrencyCard
        settings={settings}
        update={updateSystemSettings}
        refresh={fetchSystemSettings}
        isLoading={isLoading}
      />
      <TaskTraceCard
        settings={settings}
        update={updateSystemSettings}
        refresh={fetchSystemSettings}
        isLoading={isLoading}
      />
      <SystemLogCard isLoading={isLoading} />
    </div>
  )
}
