"use client"

import { useEffect } from "react"
import { Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PythonRuntimeCard } from "@/components/settings/pages/tools-extensions/python-runtime-card"
import { PythonToolsCard } from "@/components/settings/pages/tools-extensions/python-tools-card"
import { useSystemSettings } from "@/hooks/use-system-settings"

/**
 * 能力扩展 · 内置工具段：Python 工具卡（主开关 + 超时/stdout/代码长度 + 迭代上限）
 * 与 Python 运行时管理卡（纯 API 驱动，自身状态自管）。
 *
 * 段内只取一次系统设置并交给卡：卡是受控的（settings + update 从外部传入），
 * 切段或卡定位不会各自再发一遍设置请求。动态 Skill Runtime 开关不属于本段，
 * 它已由 Skill 段页头唯一持有。
 */
export function ToolsSection(): JSX.Element {
  const { settings, update, refresh, isLoading, error } = useSystemSettings()

  // 冷启动直接落到本段（搜索/深链）时 store 里可能还没有设置：补拉一次，失败由下方错误态呈现。
  useEffect(() => {
    if (settings) return
    void refresh().catch(() => {})
  }, [settings, refresh])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Terminal className="h-4 w-4 text-muted-foreground" aria-hidden />
            内置工具
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            让模型在沙箱里执行 Python 与受管依赖
          </p>
        </div>
      </div>

      {settings ? (
        <>
          <PythonToolsCard settings={settings} update={update} />
          <PythonRuntimeCard />
        </>
      ) : isLoading || !error ? (
        // 还没有结果也没有失败原因（刚挂载/补拉中）：先占位，不把「加载中」说成错误
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="py-4 text-center text-sm text-muted-foreground">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void refresh().catch(() => {})}
          >
            重试
          </Button>
        </div>
      )}
    </div>
  )
}
