"use client"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useAuthStore } from "@/store/auth-store"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useToast } from '@/components/ui/use-toast'
import { cleanupTaskTraces, getTaskTraces, getSystemLogConfig, updateSystemLogConfig, getSystemLogStats, cleanupSystemLogs, type SystemLogConfig, type SystemLogStats } from '@/features/system/api'
import { ShieldCheck, Thermometer, Trash2, FileText } from "lucide-react"
import { SettingRow } from "../components/setting-row"

export function SystemMonitoringPage() {
  const { settings, update, refresh, isLoading } = useSystemSettings()
  const { toast } = useToast()
  const { user, actorState } = useAuthStore((state) => ({ user: state.user, actorState: state.actorState }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'

  const [retentionDraft, setRetentionDraft] = useState('7')
  const [maxEventsDraft, setMaxEventsDraft] = useState('2000')
  const [idleTimeoutDraft, setIdleTimeoutDraft] = useState('30000')
  const [concurrencyDraft, setConcurrencyDraft] = useState('1')
  const [traceTotal, setTraceTotal] = useState<number | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)

  // 系统日志状态
  const [logConfig, setLogConfig] = useState<SystemLogConfig | null>(null)
  const [logStats, setLogStats] = useState<SystemLogStats | null>(null)
  const [logRetentionDraft, setLogRetentionDraft] = useState('7')
  const [logCleanupLoading, setLogCleanupLoading] = useState(false)

  const taskTraceEnabled = Boolean(settings?.taskTraceEnabled)

  useEffect(() => {
    if (typeof settings?.taskTraceRetentionDays === 'number') {
      setRetentionDraft(String(settings.taskTraceRetentionDays))
    }
    if (typeof settings?.taskTraceMaxEvents === 'number') {
      setMaxEventsDraft(String(settings.taskTraceMaxEvents))
    }
    if (typeof settings?.taskTraceIdleTimeoutMs === 'number') {
      setIdleTimeoutDraft(String(settings.taskTraceIdleTimeoutMs))
    }
    if (typeof settings?.chatMaxConcurrentStreams === 'number') {
      setConcurrencyDraft(String(settings.chatMaxConcurrentStreams))
    }
  }, [
    settings?.taskTraceRetentionDays,
    settings?.taskTraceMaxEvents,
    settings?.taskTraceIdleTimeoutMs,
    settings?.chatMaxConcurrentStreams,
  ])

  const fetchTraceStats = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await getTaskTraces({ page: 1, pageSize: 1 })
      setTraceTotal(res.data?.total ?? null)
    } catch (error: any) {
      console.warn('[SystemMonitoringPage] fetch stats failed', error)
      setTraceTotal(null)
    }
  }, [isAdmin])

  const fetchLogConfig = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await getSystemLogConfig()
      if (res.data) {
        setLogConfig(res.data)
        setLogRetentionDraft(String(res.data.retentionDays))
      }
    } catch (error: any) {
      console.warn('[SystemMonitoringPage] fetch log config failed', error)
    }
  }, [isAdmin])

  const fetchLogStats = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await getSystemLogStats()
      if (res.data) {
        setLogStats(res.data)
      }
    } catch (error: any) {
      console.warn('[SystemMonitoringPage] fetch log stats failed', error)
    }
  }, [isAdmin])

  useEffect(() => {
    if (taskTraceEnabled) {
      fetchTraceStats()
    }
  }, [taskTraceEnabled, fetchTraceStats])

  useEffect(() => {
    fetchLogConfig()
    fetchLogStats()
  }, [fetchLogConfig, fetchLogStats])

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        只有管理员可以查看日志与监控设置
      </div>
    )
  }

  const handleUpdate = async (payload: Record<string, unknown>, message = '已保存') => {
    await update(payload as any)
    await refresh()
    toast({ title: message })
  }

  const handleCleanup = async () => {
    if (!taskTraceEnabled || cleanupLoading) return
    setCleanupLoading(true)
    try {
      const input = Number.parseInt(retentionDraft, 10)
      const payload: any = {}
      if (!Number.isNaN(input)) {
        payload.retentionDays = input
      }
      const res = await cleanupTaskTraces(payload.retentionDays)
      toast({
        title: '已清理历史追踪',
        description: `依据 ${res.data?.retentionDays ?? payload.retentionDays ?? settings?.taskTraceRetentionDays ?? 7} 天保留策略删除 ${res.data?.deleted ?? 0} 条记录`,
      })
      fetchTraceStats()
    } catch (error: any) {
      toast({ title: '清理失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    } finally {
      setCleanupLoading(false)
    }
  }

  const handleLogConfigUpdate = async (config: Partial<SystemLogConfig>) => {
    try {
      const res = await updateSystemLogConfig(config)
      if (res.data) {
        setLogConfig(res.data)
        toast({ title: '日志配置已更新' })
      }
    } catch (error: any) {
      toast({ title: '更新失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    }
  }

  const handleLogCleanup = async () => {
    if (logCleanupLoading) return
    setLogCleanupLoading(true)
    try {
      const days = Number.parseInt(logRetentionDraft, 10)
      const res = await cleanupSystemLogs(Number.isNaN(days) ? undefined : days)
      toast({
        title: '已清理系统日志',
        description: `删除 ${res.data?.deleted ?? 0} 个文件，释放 ${formatBytes(res.data?.freedBytes ?? 0)}`,
      })
      fetchLogStats()
    } catch (error: any) {
      toast({ title: '清理失败', description: error?.response?.data?.error || error?.message || '未知错误', variant: 'destructive' })
    } finally {
      setLogCleanupLoading(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Thermometer className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight">并发生成控制</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              限制同时进行的流式请求数量，超出即拒绝新的消息
            </CardDescription>
          </div>
        </div>
        <SettingRow
          title="最大并发数"
          description="允许同时进行的流式请求数量（1-8）"
          align="start"
        >
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Input
              id="maxConcurrentStreams"
              type="text"
              className="w-full sm:w-32 text-right"
              value={concurrencyDraft}
              disabled={isLoading}
              onChange={(e) => setConcurrencyDraft(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={isLoading}
              onClick={async () => {
                const parsed = Number.parseInt(concurrencyDraft, 10)
                if (Number.isNaN(parsed) || parsed < 1 || parsed > 8) {
                  toast({
                    title: '输入无效',
                    description: '请输入 1-8 之间的整数',
                    variant: 'destructive',
                  })
                  return
                }
                await handleUpdate({ chatMaxConcurrentStreams: parsed }, '并发上限已更新')
              }}
            >
              保存
            </Button>
          </div>
        </SettingRow>
      </div>

      <div className="space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight">任务追踪（Task Trace）</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              记录 /api/chat/stream 生命周期，辅助排障与性能诊断
            </CardDescription>
          </div>
        </div>

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
              checked={Boolean(settings?.taskTraceDefaultOn)}
              disabled={!taskTraceEnabled || isLoading}
              onCheckedChange={(checked) => handleUpdate({ taskTraceDefaultOn: checked })}
            />
          </SettingRow>

          <SettingRow
            title="仅限管理员"
            description="若关闭，则高级用户也可手动启用追踪"
          >
            <Switch
              checked={Boolean(settings?.taskTraceAdminOnly ?? true)}
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
              value={settings?.taskTraceEnv ?? 'dev'}
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
                    toast({ title: '输入无效', description: '请填写 1-365 之间的整数', variant: 'destructive' })
                    return
                  }
                  await handleUpdate({ taskTraceRetentionDays: parsed })
                }}
              >保存</Button>
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
                    toast({ title: '输入无效', description: '请输入 100-200000 之间的整数', variant: 'destructive' })
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
                    toast({ title: '输入无效', description: '请输入 1000-600000 之间的整数', variant: 'destructive' })
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
                {cleanupLoading ? '清理中...' : '立即清理'}
              </Button>
            </div>
          </SettingRow>
        </div>
      </div>

      {/* 系统运行日志 */}
      <div className="space-y-5">
        <div className="flex items-center gap-3 pb-3 border-b">
          <FileText className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight">系统运行日志</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              记录后端服务运行状态，用于监控和排障
            </CardDescription>
          </div>
        </div>

        <div className="space-y-3">
          <SettingRow
            title="日志级别"
            description="控制日志输出的详细程度"
            align="start"
          >
            <Select
              value={logConfig?.level ?? 'info'}
              onValueChange={(value) => handleLogConfigUpdate({ level: value as SystemLogConfig['level'] })}
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
                    toast({ title: '输入无效', description: '请填写 1-365 之间的整数', variant: 'destructive' })
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
                    {logStats.totalFiles} 个文件 / {formatBytes(logStats.totalSizeBytes)}
                  </Badge>
                )}
              </div>
            )}
            description={logStats?.newestDate ? `最新: ${logStats.newestDate}，最旧: ${logStats.oldestDate}` : '暂无日志文件'}
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
                {logCleanupLoading ? '清理中...' : '立即清理'}
              </Button>
            </div>
          </SettingRow>
        </div>
      </div>
    </div>
  )
}
