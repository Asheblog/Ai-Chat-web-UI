"use client"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useAuthStore } from "@/store/auth-store"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/components/ui/use-toast"
import { apiClient } from "@/lib/api"
import { ShieldCheck, Thermometer, Trash2 } from "lucide-react"

export function SystemMonitoringPage() {
  const { settings, update, refresh, isLoading } = useSystemSettings()
  const { toast } = useToast()
  const { user, actorState } = useAuthStore((state) => ({ user: state.user, actorState: state.actorState }))
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'

  const [retentionDraft, setRetentionDraft] = useState('7')
  const [maxEventsDraft, setMaxEventsDraft] = useState('2000')
  const [idleTimeoutDraft, setIdleTimeoutDraft] = useState('30000')
  const [traceTotal, setTraceTotal] = useState<number | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)

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
  }, [settings?.taskTraceRetentionDays, settings?.taskTraceMaxEvents, settings?.taskTraceIdleTimeoutMs])

  const fetchTraceStats = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await apiClient.getTaskTraces({ page: 1, pageSize: 1 })
      setTraceTotal(res.data?.total ?? null)
    } catch (error: any) {
      console.warn('[SystemMonitoringPage] fetch stats failed', error)
      setTraceTotal(null)
    }
  }, [isAdmin])

  useEffect(() => {
    if (taskTraceEnabled) {
      fetchTraceStats()
    }
  }, [taskTraceEnabled, fetchTraceStats])

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
      const res = await apiClient.cleanupTaskTraces(payload.retentionDays)
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

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <div>
            <CardTitle>任务追踪（Task Trace）</CardTitle>
            <CardDescription>记录 /api/chat/stream 生命周期，辅助排障与性能诊断</CardDescription>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between border rounded-xl px-4 py-3">
            <div>
              <div className="font-medium">启用任务追踪</div>
              <p className="text-sm text-muted-foreground">开启后可对指定会话进行完整日志记录</p>
            </div>
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
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border p-4">
              <div className="text-sm font-semibold mb-2">默认启用</div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">管理员输入框默认勾选追踪</p>
                <Switch
                  checked={Boolean(settings?.taskTraceDefaultOn)}
                  disabled={!taskTraceEnabled || isLoading}
                  onCheckedChange={(checked) => handleUpdate({ taskTraceDefaultOn: checked })}
                />
              </div>
            </div>
            <div className="rounded-xl border p-4">
              <div className="text-sm font-semibold mb-2">仅限管理员</div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">若关闭，则高级用户也可手动启用追踪</p>
                <Switch
                  checked={Boolean(settings?.taskTraceAdminOnly ?? true)}
                  disabled={!taskTraceEnabled || isLoading}
                  onCheckedChange={(checked) => handleUpdate({ taskTraceAdminOnly: checked })}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>可用环境</Label>
              <Select
                value={settings?.taskTraceEnv ?? 'dev'}
                onValueChange={(value) => handleUpdate({ taskTraceEnv: value })}
                disabled={!taskTraceEnabled || isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择环境" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev">仅开发环境</SelectItem>
                  <SelectItem value="prod">仅生产环境</SelectItem>
                  <SelectItem value="both">开发 + 生产</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="retentionDays">保留天数</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="retentionDays"
                  type="number"
                  min={1}
                  max={365}
                  className="w-24"
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
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxEvents">单条追踪最大事件数</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="maxEvents"
                  type="number"
                  min={100}
                  max={200000}
                  className="w-32"
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
              <p className="text-xs text-muted-foreground">默认 2000，可按需调高以记录长流程（建议逐步提升避免写入过大）。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="idleTimeout">心跳超时告警（毫秒）</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="idleTimeout"
                  type="number"
                  min={1000}
                  max={600000}
                  className="w-32"
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
              <p className="text-xs text-muted-foreground">超过该时长未收到上游片段时会写入“keepalive_timeout”以辅助定位断流。</p>
            </div>
          </div>

          <div className="rounded-xl border px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-medium flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-muted-foreground" />
                当前追踪总数
                {traceTotal != null && <Badge variant="outline" className="ml-2">{traceTotal}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">用于评估数据库体量及清理频率</p>
            </div>
            <div className="flex items-center gap-2">
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
          </div>
        </div>
      </Card>
    </div>
  )
}
