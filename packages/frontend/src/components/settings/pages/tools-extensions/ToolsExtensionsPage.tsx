"use client"

import { useEffect } from "react"
import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { PythonToolsCard } from "./python-tools-card"
import { PythonRuntimeCard } from "./python-runtime-card"
import { SkillInstallCard } from "./skill-install-card"
import { BattleCard } from "./battle-card"
import { TitleSummaryCard } from "./title-summary-card"

/**
 * 工具与扩展页：页壳（单一 useSystemSettings + 共享骨架/错误重试），
 * 5 张 FeatureCard：Python 工具 / Python 运行时管理 / Skill 安装 / 模型大乱斗 / 标题智能总结。
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
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">工具与扩展</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Python 计算、Skill 安装与增强功能
          </CardDescription>
        </div>
      </div>

      <PythonToolsCard settings={settings} update={updateSystemSettings} />
      <PythonRuntimeCard />
      <SkillInstallCard />
      <BattleCard settings={settings} update={updateSystemSettings} />
      <TitleSummaryCard settings={settings} update={updateSystemSettings} />
    </div>
  )
}
