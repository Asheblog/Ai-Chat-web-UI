"use client"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/store/settings-store"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/use-toast"

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
    if(systemSettings){
      setHbMs(Number(systemSettings.sseHeartbeatIntervalMs ?? 15000))
      setIdleMs(Number(systemSettings.providerMaxIdleMs ?? 60000))
      setTimeoutMs(Number(systemSettings.providerTimeoutMs ?? 300000))
      setUsageEmit(Boolean(systemSettings.usageEmit ?? true))
      setUsageProviderOnly(Boolean(systemSettings.usageProviderOnly ?? false))
      setInitialGraceMs(Number(systemSettings.providerInitialGraceMs ?? 120000))
      setReasoningIdleMs(Number(systemSettings.providerReasoningIdleMs ?? 300000))
      setKeepaliveMs(Number(systemSettings.reasoningKeepaliveIntervalMs ?? 0))
    }
  }, [
    systemSettings?.sseHeartbeatIntervalMs,
    systemSettings?.providerMaxIdleMs,
    systemSettings?.providerTimeoutMs,
    systemSettings?.usageEmit,
    systemSettings?.usageProviderOnly,
    systemSettings?.providerInitialGraceMs,
    systemSettings?.providerReasoningIdleMs,
    systemSettings?.reasoningKeepaliveIntervalMs,
  ])

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
    <div className="p-4 space-y-6">
      <div className="text-base font-medium">网络与流式</div>
      <div className="space-y-4">
        <div>
          <Label htmlFor="sseHeartbeat" className="font-medium">SSE 心跳间隔（毫秒）</Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input id="sseHeartbeat" type="number" value={hbMs} onChange={(e)=>setHbMs(Number(e.target.value||0))} className="w-full sm:w-48" />
            <span className="text-sm text-muted-foreground w-full sm:w-24">≈ {msToSec(hbMs)}</span>
            <Button size="sm" variant="outline" onClick={()=>setHbMs(15000)} className="w-full sm:w-auto">重置为 15000</Button>
          </div>
          {!hbValid ? <p className="text-xs text-destructive mt-1">范围 {hbRange.min}–{hbRange.max}</p> : <p className="text-xs text-muted-foreground mt-1">推荐 10–15 秒</p>}
        </div>

        <div>
          <Label htmlFor="providerMaxIdle" className="font-medium">上游最大空闲（毫秒）</Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input id="providerMaxIdle" type="number" value={idleMs} onChange={(e)=>setIdleMs(Number(e.target.value||0))} className="w-full sm:w-48" />
            <span className="text-sm text-muted-foreground w-full sm:w-24">≈ {msToSec(idleMs)}</span>
            <Button size="sm" variant="outline" onClick={()=>setIdleMs(60000)} className="w-full sm:w-auto">重置为 60000</Button>
          </div>
          {!idleValid ? <p className="text-xs text-destructive mt-1">范围 {idleRange.min}–{idleRange.max}</p> : <p className="text-xs text-muted-foreground mt-1">建议 ≥ 心跳间隔</p>}
        </div>

        <div>
          <Label htmlFor="initialGrace" className="font-medium">推理初始宽限（毫秒）</Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input id="initialGrace" type="number" value={initialGraceMs} onChange={(e)=>setInitialGraceMs(Number(e.target.value||0))} className="w-full sm:w-48" />
            <span className="text-sm text-muted-foreground w-full sm:w-24">≈ {msToSec(initialGraceMs)}</span>
            <Button size="sm" variant="outline" onClick={()=>setInitialGraceMs(120000)} className="w-full sm:w-auto">重置为 120000</Button>
          </div>
          {!initialValid ? <p className="text-xs text-destructive mt-1">范围 {initialRange.min}–{initialRange.max}</p> : <p className="text-xs text-muted-foreground mt-1">等待模型吐出首帧前允许的最大空闲。</p>}
        </div>

        <div>
          <Label htmlFor="reasoningIdle" className="font-medium">推理阶段空闲上限（毫秒）</Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input id="reasoningIdle" type="number" value={reasoningIdleMs} onChange={(e)=>setReasoningIdleMs(Number(e.target.value||0))} className="w-full sm:w-48" />
            <span className="text-sm text-muted-foreground w-full sm:w-24">≈ {msToSec(reasoningIdleMs)}</span>
            <Button size="sm" variant="outline" onClick={()=>setReasoningIdleMs(300000)} className="w-full sm:w-auto">重置为 300000</Button>
          </div>
          {!reasoningIdleValid ? <p className="text-xs text-destructive mt-1">范围 {reasoningIdleRange.min}–{reasoningIdleRange.max}</p> : <p className="text-xs text-muted-foreground mt-1">收到首帧后用于控制“思考”阶段的最长静默。</p>}
        </div>

        <div>
          <Label htmlFor="keepalive" className="font-medium">推理保活提示间隔（毫秒）</Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input id="keepalive" type="number" value={keepaliveMs} onChange={(e)=>setKeepaliveMs(Number(e.target.value||0))} className="w-full sm:w-48" />
            <span className="text-sm text-muted-foreground w-full sm:w-24">{keepaliveMs === 0 ? '已禁用' : `≈ ${msToSec(keepaliveMs)}`}</span>
            <Button size="sm" variant="outline" onClick={()=>setKeepaliveMs(0)} className="w-full sm:w-auto">禁用保活提示</Button>
          </div>
          {!keepaliveValid ? <p className="text-xs text-destructive mt-1">范围 {keepaliveRange.min}–{keepaliveRange.max}</p> : <p className="text-xs text-muted-foreground mt-1">大于 0 时在推理静默期间周期性发送“思考中”事件。</p>}
        </div>

        <div>
          <Label htmlFor="providerTimeout" className="font-medium">上游总体超时（毫秒）</Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input id="providerTimeout" type="number" value={timeoutMs} onChange={(e)=>setTimeoutMs(Number(e.target.value||0))} className="w-full sm:w-48" />
            <span className="text-sm text-muted-foreground w-full sm:w-24">≈ {msToSec(timeoutMs)}</span>
            <Button size="sm" variant="outline" onClick={()=>setTimeoutMs(300000)} className="w-full sm:w-auto">重置为 300000</Button>
          </div>
          {!toutValid ? <p className="text-xs text-destructive mt-1">范围 {toutRange.min}–{toutRange.max}</p> : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="font-medium">推送用量（usage）</div>
            <p className="text-sm text-muted-foreground">开启后在流式过程中向前端发送 usage 事件</p>
          </div>
          <Switch checked={usageEmit} onCheckedChange={(v)=>setUsageEmit(!!v)} className="self-start sm:self-auto" />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="font-medium">仅透传厂商 usage</div>
            <p className="text-sm text-muted-foreground">关闭时会在结束前估算 completion/total</p>
          </div>
          <Switch checked={usageProviderOnly} onCheckedChange={(v)=>setUsageProviderOnly(!!v)} disabled={!usageEmit} className="self-start sm:self-auto" />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button onClick={save} disabled={!hbValid||!idleValid||!toutValid||!initialValid||!reasoningIdleValid||!keepaliveValid||!changed} className="w-full sm:w-auto">保存更改</Button>
        </div>
      </div>
    </div>
  )
}
