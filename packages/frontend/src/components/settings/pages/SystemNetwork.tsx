"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/store/settings-store"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"
import { Zap } from "lucide-react"

export function SystemNetworkPage() {
  const { systemSettings, fetchSystemSettings, updateSystemSettings, isLoading, error } = useSettingsStore()
  const { toast } = useToast()
  const [hbMs, setHbMs] = useState(15000)
  const [idleMs, setIdleMs] = useState(60000)
  const [timeoutMs, setTimeoutMs] = useState(300000)
  const [usageEmit, setUsageEmit] = useState(true)
  const [usageProviderOnly, setUsageProviderOnly] = useState(false)
  const [initialGraceMs, setInitialGraceMs] = useState(120000)
  const [reasoningIdleMs, setReasoningIdleMs] = useState(300000)
  const [keepaliveMs, setKeepaliveMs] = useState(0)

  useEffect(() => { fetchSystemSettings() }, [fetchSystemSettings])
  useEffect(() => {
    if (systemSettings) {
      setHbMs(Number(systemSettings.sseHeartbeatIntervalMs ?? 15000))
      setIdleMs(Number(systemSettings.providerMaxIdleMs ?? 60000))
      setTimeoutMs(Number(systemSettings.providerTimeoutMs ?? 300000))
      setUsageEmit(Boolean(systemSettings.usageEmit ?? true))
      setUsageProviderOnly(Boolean(systemSettings.usageProviderOnly ?? false))
      setInitialGraceMs(Number(systemSettings.providerInitialGraceMs ?? 120000))
      setReasoningIdleMs(Number(systemSettings.providerReasoningIdleMs ?? 300000))
      setKeepaliveMs(Number(systemSettings.reasoningKeepaliveIntervalMs ?? 0))
    }
  }, [systemSettings])

  if (isLoading && !systemSettings) {
    return (
      <div className="p-4 space-y-6">
        <div className="h-5 w-16 bg-muted rounded" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div>
                <div className="h-4 w-40 bg-muted rounded" />
                <div className="mt-2 h-3 w-72 bg-muted/70 rounded" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-28" />
                <div className="h-4 w-20 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!systemSettings) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || '无法加载系统设置'}</p>
        <button className="mt-3 px-3 py-2 border rounded" onClick={()=>fetchSystemSettings()}>重试</button>
      </div>
    )
  }
  const msToSec = (v:number)=>v === 0 ? '已禁用' : `${Math.round(v/1000)} 秒`
  const within = (v:number,min:number,max:number)=>v>=min&&v<=max
  const hbRange={min:1000,max:600000}
  const idleRange={min:0,max:3600000}
  const toutRange={min:10000,max:3600000}
  const initialRange={min:0,max:3600000}
  const reasoningIdleRange={min:0,max:3600000}
  const keepaliveRange={min:0,max:3600000}
  const hbValid=within(hbMs,hbRange.min,hbRange.max)
  const idleValid=within(idleMs,idleRange.min,idleRange.max)
  const toutValid=within(timeoutMs,toutRange.min,toutRange.max)
  const initialValid=within(initialGraceMs,initialRange.min,initialRange.max)
  const reasoningIdleValid=within(reasoningIdleMs,reasoningIdleRange.min,reasoningIdleRange.max)
  const keepaliveValid=within(keepaliveMs,keepaliveRange.min,keepaliveRange.max)

  const changed = (
    hbMs !== Number(systemSettings.sseHeartbeatIntervalMs ?? 15000) ||
    idleMs !== Number(systemSettings.providerMaxIdleMs ?? 60000) ||
    timeoutMs !== Number(systemSettings.providerTimeoutMs ?? 300000) ||
    initialGraceMs !== Number(systemSettings.providerInitialGraceMs ?? 120000) ||
    reasoningIdleMs !== Number(systemSettings.providerReasoningIdleMs ?? 300000) ||
    keepaliveMs !== Number(systemSettings.reasoningKeepaliveIntervalMs ?? 0) ||
    usageEmit !== Boolean(systemSettings.usageEmit ?? true) ||
    usageProviderOnly !== Boolean(systemSettings.usageProviderOnly ?? false)
  )

  const save = async()=>{
    if(!hbValid||!idleValid||!toutValid||!initialValid||!reasoningIdleValid||!keepaliveValid) return
    await updateSystemSettings({
      sseHeartbeatIntervalMs: hbMs,
      providerMaxIdleMs: idleMs,
      providerTimeoutMs: timeoutMs,
      providerInitialGraceMs: initialGraceMs,
      providerReasoningIdleMs: reasoningIdleMs,
      reasoningKeepaliveIntervalMs: keepaliveMs,
      usageEmit,
      usageProviderOnly,
    })
    toast({ title: '已保存' })
  }

  return (
    <div className="space-y-6">

      {/* 网络配置区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Zap className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-lg font-semibold">连接与超时</h3>
            <p className="text-sm text-muted-foreground">管理网络连接的时间参数</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">SSE 心跳间隔</div>
            <div className="text-sm text-muted-foreground mt-1.5">推荐 10–15 秒，当前约 {msToSec(hbMs)}</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input id="sseHeartbeat" type="number" value={hbMs} onChange={(e)=>setHbMs(Number(e.target.value||0))} className="w-28 text-right" />
            <span className="text-sm text-muted-foreground">ms</span>
            <Button size="sm" variant="outline" onClick={()=>setHbMs(15000)}>重置</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">上游最大空闲</div>
            <div className="text-sm text-muted-foreground mt-1.5">建议 ≥ 心跳间隔，当前约 {msToSec(idleMs)}</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input id="providerMaxIdle" type="number" value={idleMs} onChange={(e)=>setIdleMs(Number(e.target.value||0))} className="w-28 text-right" />
            <span className="text-sm text-muted-foreground">ms</span>
            <Button size="sm" variant="outline" onClick={()=>setIdleMs(60000)}>重置</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">推理初始宽限</div>
            <div className="text-sm text-muted-foreground mt-1.5">等待模型首帧前的最大空闲，当前约 {msToSec(initialGraceMs)}</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input id="initialGrace" type="number" value={initialGraceMs} onChange={(e)=>setInitialGraceMs(Number(e.target.value||0))} className="w-28 text-right" />
            <span className="text-sm text-muted-foreground">ms</span>
            <Button size="sm" variant="outline" onClick={()=>setInitialGraceMs(120000)}>重置</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">推理阶段空闲上限</div>
            <div className="text-sm text-muted-foreground mt-1.5">收到首帧后思考阶段的最长静默，当前约 {msToSec(reasoningIdleMs)}</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input id="reasoningIdle" type="number" value={reasoningIdleMs} onChange={(e)=>setReasoningIdleMs(Number(e.target.value||0))} className="w-28 text-right" />
            <span className="text-sm text-muted-foreground">ms</span>
            <Button size="sm" variant="outline" onClick={()=>setReasoningIdleMs(300000)}>重置</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">推理保活提示间隔</div>
            <div className="text-sm text-muted-foreground mt-1.5">大于 0 时在推理静默期间周期性发送&ldquo;思考中&rdquo;事件</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input id="keepalive" type="number" value={keepaliveMs} onChange={(e)=>setKeepaliveMs(Number(e.target.value||0))} className="w-28 text-right" />
            <span className="text-sm text-muted-foreground">ms</span>
            <Button size="sm" variant="outline" onClick={()=>setKeepaliveMs(0)}>禁用</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">上游总体超时</div>
            <div className="text-sm text-muted-foreground mt-1.5">整个请求的最长等待时间，当前约 {msToSec(timeoutMs)}</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <Input id="providerTimeout" type="number" value={timeoutMs} onChange={(e)=>setTimeoutMs(Number(e.target.value||0))} className="w-28 text-right" />
            <span className="text-sm text-muted-foreground">ms</span>
            <Button size="sm" variant="outline" onClick={()=>setTimeoutMs(300000)}>重置</Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">推送用量（usage）</div>
            <div className="text-sm text-muted-foreground mt-1.5">开启后在流式过程中向前端发送 usage 事件</div>
          </div>
          <div className="shrink-0">
            <Switch checked={usageEmit} onCheckedChange={(v)=>setUsageEmit(!!v)} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-6 px-5 py-5 rounded-lg border border-border bg-card transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex-1">
            <div className="font-medium">仅透传厂商 usage</div>
            <div className="text-sm text-muted-foreground mt-1.5">关闭时会在结束前估算 completion/total</div>
          </div>
          <div className="shrink-0">
            <Switch checked={usageProviderOnly} onCheckedChange={(v)=>setUsageProviderOnly(!!v)} disabled={!usageEmit} />
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={save} disabled={!hbValid||!idleValid||!toutValid||!initialValid||!reasoningIdleValid||!keepaliveValid||!changed}>保存设置</Button>
        </div>
      </div>
    </div>
  )
}
