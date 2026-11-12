"use client"

import { Download, Loader2, RefreshCw, Settings2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"

export type SystemConnectionsHeaderProps = {
  totalGroups: number
  loading: boolean
  importing: boolean
  exporting: boolean
  onImport: () => void
  onExport: () => void
  onRefresh: () => void
}

/** 高级管理标题栏：标题 + 端点组数量 + 导入/导出/刷新。 */
export function SystemConnectionsHeader({
  totalGroups,
  loading,
  importing,
  exporting,
  onImport,
  onExport,
  onRefresh,
}: SystemConnectionsHeaderProps) {
  const busy = loading || importing || exporting

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Settings2 aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="v2-section-title">高级管理</h2>
        <span className="v2-status">{totalGroups} 个端点组</span>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onImport} disabled={busy}>
          {importing ? (
            <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload aria-hidden className="mr-1.5 h-4 w-4" />
          )}
          导入
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} disabled={busy}>
          {exporting ? (
            <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Download aria-hidden className="mr-1.5 h-4 w-4" />
          )}
          导出
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy}>
          {loading ? (
            <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw aria-hidden className="mr-1.5 h-4 w-4" />
          )}
          刷新
        </Button>
      </div>
    </div>
  )
}
