"use client"

import { useEffect } from "react"
import { Palette } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { AvatarCard } from "./avatar-card"
import { BrandingCard } from "./branding-card"

/**
 * 外观与站点页：品牌名、AI 头像与站点地址属于主层；6 个主题色 Token 在品牌卡的「主题配色」里。
 * 全局系统提示词不在本页——它属于「连接与模型 → 会话默认配置」。
 */
export function BrandingPage() {
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
        <Palette className="w-5 h-5 text-ink-tertiary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle>外观与站点</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            品牌名、AI 头像、站点地址与主题配色
          </CardDescription>
        </div>
      </div>

      <AvatarCard settings={settings} update={updateSystemSettings} />
      <BrandingCard settings={settings} update={updateSystemSettings} />
    </div>
  )
}
