"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { FileText, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import {
  cleanupSystemLogs,
  getSystemLogConfig,
  getSystemLogStats,
  updateSystemLogConfig,
  type SystemLogConfig,
  type SystemLogStats,
} from "@/features/system/api"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import { formatFileSize } from "@/lib/format"

export interface SystemLogCardProps {
  isLoading: boolean
}

/**
 * 系统运行日志卡：日志级别/写入文件/保留天数（updateSystemLogConfig）+ 统计/清理
 * （getSystemLogStats/cleanupSystemLogs），适配自 SystemMonitoringPage。
 */
export function SystemLogCard({ isLoading }: SystemLogCardProps) {
  const { toast } = useToast()
  const [logConfig, setLogConfig] = useState<SystemLogConfig | null>(null)
  const [logStats, setLogStats] = useState<SystemLogStats | null>(null)
  const [logRetentionDraft, setLogRetentionDraft] = useState("7")
  const [logCleanupLoading, setLogCleanupLoading] = useState(false)

  const fetchLogConfig = useCallback(async () => {
    try {
      const res = await getSystemLogConfig()
      if (res.data) {
        setLogConfig(res.data)
        setLogRetentionDraft(String(res.data.retentionDays))
      }
    } catch (error: any) {
      console.warn("[SystemLogCard] fetch log config failed", error)
    }
  }, [])

  const fetchLogStats = useCallback(async () => {
    try {
      const res = await getSystemLogStats()
      if (res.data) {
        setLogStats(res.data)
      }
    } catch (error: any) {
      console.warn("[SystemLogCard] fetch log stats failed", error)
    }
  }, [])

  useEffect(() => {
    fetchLogConfig()
    fetchLogStats()
  }, [fetchLogConfig, fetchLogStats])

  const handleLogConfigUpdate = async (config: Partial<SystemLogConfig>) => {
    try {
      const res = await updateSystemLogConfig(config)
      if (res.data) {
        setLogConfig(res.data)
        toast({ title: "日志配置已更新" })
      }
    } catch (error: any) {
      toast({ title: "更新失败", description: error?.response?.data?.error || error?.message || "未知错误", variant: "destructive" })
    }
  }

  const handleLogCleanup = async () => {
    if (logCleanupLoading) return
    setLogCleanupLoading(true)
    try {
      const days = Number.parseInt(logRetentionDraft, 10)
      const res = await cleanupSystemLogs(Number.isNaN(days) ? undefined : days)
      toast({
        title: "已清理系统日志",
        description: `删除 ${res.data?.deleted ?? 0} 个文件，释放 ${formatFileSize(res.data?.freedBytes ?? 0)}`,
      })
      fetchLogStats()
    } catch (error: any) {
      toast({ title: "清理失败", description: error?.response?.data?.error || error?.message || "未知错误", variant: "destructive" })
    } finally {
      setLogCleanupLoading(false)
    }
  }

  return (
    <FeatureCard
      icon={FileText}
      title="系统运行日志"
      description="后端日志级别、文件输出与保留"
      cardKey="data-maintenance:system-log"
    >
      <div className="space-y-3">
        <SettingRow
          title="日志级别"
          description="控制日志输出的详细程度"
          align="start"
        >
          <Select
            value={logConfig?.level ?? "info"}
            onValueChange={(value) => handleLogConfigUpdate({ level: value as SystemLogConfig["level"] })}
            disabled={isLoading}
          >
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="选择级别" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debug">调试 (Debug) - 最详细</SelectItem>
              <SelectItem value="info">信息 (Info) - 默认</SelectItem>
              <SelectItem value="warn">警告 (Warn)</SelectItem>
              <SelectItem value="error">错误 (Error) - 仅错误</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          title="写入文件"
          description="将日志同时写入文件，便于后续查询"
        >
          <Switch
            checked={logConfig?.toFile ?? true}
            disabled={isLoading}
            onCheckedChange={(checked) => handleLogConfigUpdate({ toFile: checked })}
          />
        </SettingRow>

        <SettingRow
          title="保留天数"
          description="超过该天数的日志文件会被自动清理（范围 1-365）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="logRetentionDays"
              type="text"
              className="w-full sm:w-32 text-right"
              value={logRetentionDraft}
              disabled={isLoading}
              onChange={(e) => setLogRetentionDraft(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={isLoading}
              onClick={async () => {
                const parsed = Number.parseInt(logRetentionDraft, 10)
                if (Number.isNaN(parsed) || parsed < 1 || parsed > 365) {
                  toast({ title: "输入无效", description: "请填写 1-365 之间的整数", variant: "destructive" })
                  return
                }
                await handleLogConfigUpdate({ retentionDays: parsed })
              }}
            >
              保存
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          title={(
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              日志统计
              {logStats && (
                <Badge variant="outline">
                  {logStats.totalFiles} 个文件 / {formatFileSize(logStats.totalSizeBytes)}
                </Badge>
              )}
            </div>
          )}
          description={logStats?.newestDate ? `最新: ${logStats.newestDate}，最旧: ${logStats.oldestDate}` : "暂无日志文件"}
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button asChild variant="secondary">
              <Link href="/main/logs/system">查看日志</Link>
            </Button>
            <Button
              variant="destructive"
              disabled={logCleanupLoading || !logStats?.totalFiles}
              onClick={handleLogCleanup}
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {logCleanupLoading ? "清理中..." : "立即清理"}
            </Button>
          </div>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
