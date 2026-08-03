"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ShieldCheck, Thermometer, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { cleanupTaskTraces, getTaskTraces } from "@/features/system/api"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import type { SystemSettings } from "@/types"

export interface TaskTraceCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
}

/**
 * 任务追踪卡：taskTrace* 系列 key（启用开关自动保存、其余行内保存/自动保存），
 * 统计与清理（cleanupTaskTraces）适配自 SystemMonitoringPage。
 */
export function TaskTraceCard({ settings, update, refresh, isLoading }: TaskTraceCardProps) {
  const { toast } = useToast()
  const [retentionDraft, setRetentionDraft] = useState("7")
  const [maxEventsDraft, setMaxEventsDraft] = useState("2000")
  const [idleTimeoutDraft, setIdleTimeoutDraft] = useState("30000")
  const [traceTotal, setTraceTotal] = useState<number | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)

  const taskTraceEnabled = Boolean(settings.taskTraceEnabled)

  useEffect(() => {
    if (typeof settings.taskTraceRetentionDays === "number") {
      setRetentionDraft(String(settings.taskTraceRetentionDays))
    }
    if (typeof settings.taskTraceMaxEvents === "number") {
      setMaxEventsDraft(String(settings.taskTraceMaxEvents))
    }
    if (typeof settings.taskTraceIdleTimeoutMs === "number") {
      setIdleTimeoutDraft(String(settings.taskTraceIdleTimeoutMs))
    }
  }, [
    settings.taskTraceRetentionDays,
    settings.taskTraceMaxEvents,
    settings.taskTraceIdleTimeoutMs,
  ])

  const fetchTraceStats = useCallback(async () => {
    try {
      const res = await getTaskTraces({ page: 1, pageSize: 1 })
      setTraceTotal(res.data?.total ?? null)
    } catch (error: any) {
      console.warn("[TaskTraceCard] fetch stats failed", error)
      setTraceTotal(null)
    }
  }, [])

  useEffect(() => {
    if (taskTraceEnabled) {
      fetchTraceStats()
    }
  }, [taskTraceEnabled, fetchTraceStats])

  const handleUpdate = async (payload: Record<string, unknown>, message = "已保存") => {
    await update(payload as Partial<SystemSettings>)
    await refresh()
    toast({ title: message })
  }

  const handleCleanup = async () => {
    if (!taskTraceEnabled || cleanupLoading) return
    setCleanupLoading(true)
    try {
      const input = Number.parseInt(retentionDraft, 10)
      const payload: Record<string, number> = {}
      if (!Number.isNaN(input)) {
        payload.retentionDays = input
      }
      const res = await cleanupTaskTraces(payload.retentionDays)
      toast({
        title: "已清理历史追踪",
        description: `依据 ${res.data?.retentionDays ?? payload.retentionDays ?? settings.taskTraceRetentionDays ?? 7} 天保留策略删除 ${res.data?.deleted ?? 0} 条记录`,
      })
      fetchTraceStats()
    } catch (error: any) {
      toast({ title: "清理失败", description: error?.response?.data?.error || error?.message || "未知错误", variant: "destructive" })
    } finally {
      setCleanupLoading(false)
    }
  }

  return (
    <FeatureCard
      icon={ShieldCheck}
      title="任务追踪"
      description="记录后台任务执行，用于性能诊断"
    >
      <div className="space-y-3">
        <SettingRow
          title="启用任务追踪"
          description="开启后可对指定会话进行完整日志记录"
        >
          <Switch
            checked={taskTraceEnabled}
            disabled={isLoading}
            onCheckedChange={async (checked) => {
              await handleUpdate({ taskTraceEnabled: checked })
              if (!checked) {
                setTraceTotal(null)
              }
            }}
          />
        </SettingRow>

        <SettingRow
          title="默认启用"
          description="管理员输入框默认勾选追踪"
        >
          <Switch
            checked={Boolean(settings.taskTraceDefaultOn)}
            disabled={!taskTraceEnabled || isLoading}
            onCheckedChange={(checked) => handleUpdate({ taskTraceDefaultOn: checked })}
          />
        </SettingRow>

        <SettingRow
          title="仅限管理员"
          description="若关闭，则高级用户也可手动启用追踪"
        >
          <Switch
            checked={Boolean(settings.taskTraceAdminOnly ?? true)}
            disabled={!taskTraceEnabled || isLoading}
            onCheckedChange={(checked) => handleUpdate({ taskTraceAdminOnly: checked })}
          />
        </SettingRow>

        <SettingRow
          title="可用环境"
          description="限制任务追踪可被激活的运行环境"
          align="start"
        >
          <Select
            value={settings.taskTraceEnv ?? "dev"}
            onValueChange={(value) => handleUpdate({ taskTraceEnv: value })}
            disabled={!taskTraceEnabled || isLoading}
          >
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="选择环境" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dev">仅开发环境</SelectItem>
              <SelectItem value="prod">仅生产环境</SelectItem>
              <SelectItem value="both">开发 + 生产</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          title="保留天数"
          description="超过该天数的历史追踪会被自动清理（范围 1-365）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="retentionDays"
              type="text"
              className="w-full sm:w-32 text-right"
              value={retentionDraft}
              disabled={!taskTraceEnabled || isLoading}
              onChange={(e) => setRetentionDraft(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!taskTraceEnabled || isLoading}
              onClick={async () => {
                const parsed = Number.parseInt(retentionDraft, 10)
                if (Number.isNaN(parsed) || parsed < 1) {
                  toast({ title: "输入无效", description: "请填写 1-365 之间的整数", variant: "destructive" })
                  return
                }
                await handleUpdate({ taskTraceRetentionDays: parsed })
              }}
            >
              保存
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          title="单条追踪最大事件数"
          description="默认 2000，可按需调高以记录长流程（范围 100-200000，建议逐步提升避免写入过大）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="maxEvents"
              type="text"
              className="w-full sm:w-32 text-right"
              value={maxEventsDraft}
              disabled={!taskTraceEnabled || isLoading}
              onChange={(e) => setMaxEventsDraft(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!taskTraceEnabled || isLoading}
              onClick={async () => {
                const parsed = Number.parseInt(maxEventsDraft, 10)
                if (Number.isNaN(parsed) || parsed < 100) {
                  toast({ title: "输入无效", description: "请输入 100-200000 之间的整数", variant: "destructive" })
                  return
                }
                await handleUpdate({ taskTraceMaxEvents: parsed })
              }}
            >
              保存
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          title="心跳超时告警（毫秒）"
          description="超过该时长未收到上游片段时会写入 keepalive_timeout 事件（范围 1000-600000 ms）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="idleTimeout"
              type="text"
              className="w-full sm:w-32 text-right"
              value={idleTimeoutDraft}
              disabled={!taskTraceEnabled || isLoading}
              onChange={(e) => setIdleTimeoutDraft(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!taskTraceEnabled || isLoading}
              onClick={async () => {
                const parsed = Number.parseInt(idleTimeoutDraft, 10)
                if (Number.isNaN(parsed) || parsed < 1000) {
                  toast({ title: "输入无效", description: "请输入 1000-600000 之间的整数", variant: "destructive" })
                  return
                }
                await handleUpdate({ taskTraceIdleTimeoutMs: parsed })
              }}
            >
              保存
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          title={(
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-muted-foreground" />
              当前追踪总数
              {traceTotal != null && <Badge variant="outline">{traceTotal}</Badge>}
            </div>
          )}
          description="用于评估数据库体量及清理频率"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button asChild variant="secondary">
              <Link href="/main/logs/task-trace">查看日志</Link>
            </Button>
            <Button
              variant="destructive"
              disabled={!taskTraceEnabled || cleanupLoading}
              onClick={handleCleanup}
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              {cleanupLoading ? "清理中..." : "立即清理"}
            </Button>
          </div>
        </SettingRow>
      </div>
    </FeatureCard>
  )
}
