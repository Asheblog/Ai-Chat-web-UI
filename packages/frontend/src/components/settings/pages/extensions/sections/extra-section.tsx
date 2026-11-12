"use client"

import { useEffect } from "react"
import { Swords } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BattleCard } from "@/components/settings/pages/tools-extensions/battle-card"
import { TitleSummaryCard } from "@/components/settings/pages/tools-extensions/title-summary-card"
import { useSystemSettings } from "@/hooks/use-system-settings"

/**
 * 能力扩展 · 对话增强段：模型大乱斗（battle*）与标题智能总结（titleSummary*）。
 *
 * 与内置工具段同一套取数方式：段内取一次系统设置，两张卡保持受控
 * （settings + update 从外部传入），各自只提交自己那几个 key。
 */
export function ExtraSection(): JSX.Element {
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
            <Swords className="h-4 w-4 text-muted-foreground" aria-hidden />
            对话增强
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">模型大乱斗与标题智能总结</p>
        </div>
      </div>

      {settings ? (
        <>
          <BattleCard settings={settings} update={update} />
          <TitleSummaryCard settings={settings} update={update} />
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
