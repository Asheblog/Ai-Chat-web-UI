"use client"

import { useEffect, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { describeSettingsLocation } from "../system-settings-registry"

const BANNER_DURATION_MS = 3000

/**
 * SettingsLocationBanner: 搜索跳转后的位置提示条。
 * 显示「已定位到：分组 → 页面 · 卡」的完整路径，约 3s 后自动消失；
 * 自身为 aria-live 区域，屏幕阅读器同步播报。
 */
export function SettingsLocationBanner({ leafKey, cardKey }: { leafKey: string; cardKey?: string }) {
  const [visible, setVisible] = useState(true)
  const path = describeSettingsLocation(leafKey, cardKey)

  useEffect(() => {
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), BANNER_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [leafKey, cardKey])

  if (!visible || !path) return null

  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 rounded-[8px] border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm text-foreground"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 truncate">
        <span className="font-medium">已定位到：</span>
        {path}
      </span>
    </div>
  )
}
