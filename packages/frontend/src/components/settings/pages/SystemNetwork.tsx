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

  useEffect(() => { fetchSystemSettings() }, [fetchSystemSettings])
  useEffect(() => {
    if(systemSettings){
      setHbMs(Number(systemSettings.sseHeartbeatIntervalMs ?? 15000))
      setIdleMs(Number(systemSettings.providerMaxIdleMs ?? 60000))
      setTimeoutMs(Number(systemSettings.providerTimeoutMs ?? 300000))
      setUsageEmit(Boolean(systemSettings.usageEmit ?? true))
      setUsageProviderOnly(Boolean(systemSettings.usageProviderOnly ?? false))
    }
  }, [systemSettings?.sseHeartbeatIntervalMs, systemSettings?.providerMaxIdleMs, systemSettings?.providerTimeoutMs, systemSettings?.usageEmit, systemSettings?.usageProviderOnly])

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
  const msToSec = (v:number)=>`${Math.round(v/1000)} 秒`
  const within = (v:number,min:number,max:number)=>v>=min&&v<=max
  const hbRange={min:1000,max:600000}
  const idleRange={min:0,max:3600000}
  const toutRange={min:10000,max:3600000}
  const hbValid=within(hbMs,hbRange.min,hbRange.max)
  const idleValid=within(idleMs,idleRange.min,idleRange.max)
  const toutValid=within(timeoutMs,toutRange.min,toutRange.max)

  const changed = (
    hbMs !== Number(systemSettings.sseHeartbeatIntervalMs ?? 15000) ||
    idleMs !== Number(systemSettings.providerMaxIdleMs ?? 60000) ||
    timeoutMs !== Number(systemSettings.providerTimeoutMs ?? 300000) ||
    usageEmit !== Boolean(systemSettings.usageEmit ?? true) ||
    usageProviderOnly !== Boolean(systemSettings.usageProviderOnly ?? false)
  )

  const save = async()=>{
    if(!hbValid||!idleValid||!toutValid) return
    await updateSystemSettings({
      sseHeartbeatIntervalMs: hbMs,
      providerMaxIdleMs: idleMs,
      providerTimeoutMs: timeoutMs,
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
          <Button onClick={save} disabled={!hbValid||!idleValid||!toutValid||!changed} className="w-full sm:w-auto">保存更改</Button>
        </div>
      </div>
    </div>
  )
}
