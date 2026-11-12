"use client"

import { useEffect } from "react"
import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { PythonToolsCard } from "./python-tools-card"
import { PythonRuntimeCard } from "./python-runtime-card"
import { BattleCard } from "./battle-card"
import { TitleSummaryCard } from "./title-summary-card"

/**
 * 工具与扩展页（已从系统设置下线，仅保留给尚未迁移的用例）：
 * 页壳（单一 useSystemSettings + 共享骨架/错误重试）+ 4 张 FeatureCard。
 * Skill 安装已随能力扩展页迁至「Skill」段，不再属于本页。
 */
export function ToolsExtensionsPage() {
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
        <Wrench className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle>工具与扩展</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Python 计算与增强功能
          </CardDescription>
        </div>
      </div>

      <PythonToolsCard settings={settings} update={updateSystemSettings} />
      <PythonRuntimeCard />
      <BattleCard settings={settings} update={updateSystemSettings} />
      <TitleSummaryCard settings={settings} update={updateSystemSettings} />
    </div>
  )
}
