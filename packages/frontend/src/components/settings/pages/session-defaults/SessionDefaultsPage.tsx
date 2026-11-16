"use client"

import { useEffect } from "react"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { SystemPromptCard } from "./system-prompt-card"

/**
 * 会话默认配置页：对话层的全局默认项（当前只有全局系统提示词）。
 * 页壳与其余设置页一致：单一 useSystemSettings + 共享骨架/错误重试。
 */
export function SessionDefaultsPage() {
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
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <MessageSquare className="w-5 h-5 text-ink-tertiary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle>会话默认配置</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            所有会话共用的基础提示词；会话可以覆盖它，个人偏好作为追加层
          </CardDescription>
        </div>
      </div>

      <SystemPromptCard settings={settings} update={updateSystemSettings} />
    </div>
  )
}
