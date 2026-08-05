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
 * 品牌与界面页：页壳（单一 useSystemSettings + 共享骨架/错误重试），
 * 2 张 FeatureCard：AI 头像 / 品牌定制（文字 LOGO、全局系统提示词、图片访问域名）。
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
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <Palette className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle>品牌与界面</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            AI 头像、品牌标识与站点信息
          </CardDescription>
        </div>
      </div>

      <AvatarCard settings={settings} update={updateSystemSettings} />
      <BrandingCard settings={settings} update={updateSystemSettings} />
    </div>
  )
}
