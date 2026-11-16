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

const ENV_LABELS: Record<string, string> = {
  dev: "仅开发环境",
  prod: "仅生产环境",
  both: "开发 + 生产",
}

/**
 * 任务追踪卡：总开关走卡头，生效环境/权限/默认追踪组成一个策略组（四道闸门一起读），
 * 保留天数只服务「立即清理」；事件数与心跳告警收进「高级参数」。
 */
export function TaskTraceCard({ settings, update, refresh, isLoading }: TaskTraceCardProps) {
  const { toast } = useToast()
  const [retentionDraft, setRetentionDraft] = useState("7")
  const [maxEventsDraft, setMaxEventsDraft] = useState("2000")
  const [idleTimeoutDraft, setIdleTimeoutDraft] = useState("30000")
  const [traceTotal, setTraceTotal] = useState<number | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const taskTraceEnabled = Boolean(settings.taskTraceEnabled)
  const taskTraceEnv = settings.taskTraceEnv ?? "dev"
  const adminOnly = Boolean(settings.taskTraceAdminOnly ?? true)
  const defaultOn = Boolean(settings.taskTraceDefaultOn)

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
    setSaving(true)
    try {
      await update(payload as Partial<SystemSettings>)
      await refresh()
      toast({ title: message })
      return true
    } catch (error: any) {
      toast({
        title: "保存失败",
        description: error?.message || "设置未保存，请重试",
        variant: "destructive",
      })
      return false
    } finally {
      setSaving(false)
    }
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
        description: `按 ${res.data?.retentionDays ?? payload.retentionDays ?? settings.taskTraceRetentionDays ?? 7} 天阈值删除 ${res.data?.deleted ?? 0} 条记录`,
      })
      fetchTraceStats()
    } catch (error: any) {
      toast({ title: "清理失败", description: error?.response?.data?.error || error?.message || "未知错误", variant: "destructive" })
    } finally {
      setCleanupLoading(false)
    }
  }

  const policySummary = [
    taskTraceEnabled ? "总开关已开启" : "总开关已关闭",
    ENV_LABELS[taskTraceEnv] ?? taskTraceEnv,
    adminOnly ? "仅管理员可开启" : "管理员与高级用户可开启",
    defaultOn ? "默认追踪" : "默认不追踪，需请求侧勾选",
  ].join(" · ")

  return (
    <FeatureCard
      icon={ShieldCheck}
      title="任务追踪"
      description="记录后台任务执行事件，用于性能诊断与问题复盘"
      cardKey="data-maintenance:task-trace"
      enabled={taskTraceEnabled}
      onEnabledChange={async (checked) => {
        const ok = await handleUpdate({ taskTraceEnabled: checked }, checked ? "已开启任务追踪" : "已关闭任务追踪")
        if (ok && !checked) {
          setTraceTotal(null)
        }
      }}
      moreLabel="高级参数"
      more={
        <div className="space-y-3">
          <SettingRow
            title="单条追踪最大事件数"
            description="单条追踪的事件上限，默认 2000（范围 100-200000），逐步调高以避免写入过大"
            align="start"
          >
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                id="maxEvents"
                type="text"
                className="w-full sm:w-32 text-right"
                value={maxEventsDraft}
                disabled={isLoading || saving}
                onChange={(e) => setMaxEventsDraft(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={isLoading || saving}
                onClick={async () => {
                  const parsed = Number.parseInt(maxEventsDraft, 10)
                  if (Number.isNaN(parsed) || parsed < 100 || parsed > 200000) {
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
            description="超过该时长未收到上游片段时写入 keepalive_timeout 事件（范围 1000-600000 ms）"
            align="start"
          >
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                id="idleTimeout"
                type="text"
                className="w-full sm:w-32 text-right"
                value={idleTimeoutDraft}
                disabled={isLoading || saving}
                onChange={(e) => setIdleTimeoutDraft(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={isLoading || saving}
                onClick={async () => {
                  const parsed = Number.parseInt(idleTimeoutDraft, 10)
                  if (Number.isNaN(parsed) || parsed < 1000 || parsed > 600000) {
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
        </div>
      }
    >
      <div className="space-y-3">
        <SettingRow
          title="生效环境"
          description="按部署的 NODE_ENV 判定：开发＝非 production，生产＝production。生产部署选「仅开发环境」时，总开关打开也不会记录"
          align="start"
        >
          <Select
            value={taskTraceEnv}
            onValueChange={(value) => handleUpdate({ taskTraceEnv: value })}
            disabled={isLoading || saving}
          >
            <SelectTrigger className="w-full sm:w-[220px]" aria-label="生效环境">
              <SelectValue placeholder="选择环境" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dev">仅开发环境（非 production）</SelectItem>
              <SelectItem value="prod">仅生产环境（production）</SelectItem>
              <SelectItem value="both">开发 + 生产</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          title="仅限管理员"
          description="关闭后，高级用户也可以手动开启追踪；管理员始终可用"
        >
          <Switch
            checked={adminOnly}
            disabled={isLoading || saving}
            onCheckedChange={(checked) => handleUpdate({ taskTraceAdminOnly: checked })}
          />
        </SettingRow>

        <SettingRow
          title="默认追踪"
          description="请求未显式勾选时按此默认决定；关闭时要请求侧手动打开才会记录"
        >
          <Switch
            checked={defaultOn}
            disabled={isLoading || saving}
            onCheckedChange={(checked) => handleUpdate({ taskTraceDefaultOn: checked })}
          />
        </SettingRow>

        <p className="text-xs leading-5 text-muted-foreground">
          当前策略：{policySummary}。四道闸门（总开关 / 生效环境 / 权限 / 请求侧追踪标记）同时满足才会产生记录。
        </p>

        <SettingRow
          title="保留天数"
          description="仅作为「立即清理」的删除阈值，系统不会按时间自动清理（范围 1-365 天）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="retentionDays"
              type="text"
              className="w-full sm:w-32 text-right"
              value={retentionDraft}
              disabled={!taskTraceEnabled || isLoading || saving}
              onChange={(e) => setRetentionDraft(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={!taskTraceEnabled || isLoading || saving}
              onClick={async () => {
                const parsed = Number.parseInt(retentionDraft, 10)
                if (Number.isNaN(parsed) || parsed < 1 || parsed > 365) {
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
