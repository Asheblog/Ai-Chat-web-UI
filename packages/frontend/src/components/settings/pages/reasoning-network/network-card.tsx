"use client"

import { Network } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import { parseNumericInput } from "@/features/settings/shared"

export interface NetworkValidity {
  hb: boolean
  idle: boolean
  initialGrace: boolean
  reasoningIdle: boolean
  keepalive: boolean
  timeout: boolean
}

export interface NetworkCardProps {
  hbMs: number
  onHbMsChange: (v: number) => void
  idleMs: number
  onIdleMsChange: (v: number) => void
  initialGraceMs: number
  onInitialGraceMsChange: (v: number) => void
  reasoningIdleMs: number
  onReasoningIdleMsChange: (v: number) => void
  keepaliveMs: number
  onKeepaliveMsChange: (v: number) => void
  timeoutMs: number
  onTimeoutMsChange: (v: number) => void
  usageEmit: boolean
  onUsageEmitChange: (v: boolean) => void
  usageProviderOnly: boolean
  onUsageProviderOnlyChange: (v: boolean) => void
  validity: NetworkValidity
}

/**
 * 网络与超时卡：8 行全部位于「更多参数」折叠区（源 SystemNetwork 全部行，
 * 保留每字段 重置/禁用 按钮与范围无效红色描边）。
 */
export function NetworkCard({
  hbMs,
  onHbMsChange,
  idleMs,
  onIdleMsChange,
  initialGraceMs,
  onInitialGraceMsChange,
  reasoningIdleMs,
  onReasoningIdleMsChange,
  keepaliveMs,
  onKeepaliveMsChange,
  timeoutMs,
  onTimeoutMsChange,
  usageEmit,
  onUsageEmitChange,
  usageProviderOnly,
  onUsageProviderOnlyChange,
  validity,
}: NetworkCardProps) {
  const msToSec = (v: number) => (v === 0 ? '已禁用' : `${Math.round(v / 1000)} 秒`)
  const inputClass = (valid: boolean) =>
    valid ? 'w-full sm:w-32 text-right' : 'w-full sm:w-32 text-right border-destructive'

  return (
    <FeatureCard
      icon={Network}
      title="网络与超时"
      description="管理 SSE 心跳与上游网络连接超时"
      cardKey="reasoning-network:network"
      moreLabel="更多参数"
      more={
        <>
          <SettingRow
            title="SSE 心跳间隔"
            description={`推荐 10–15 秒，当前约 ${msToSec(hbMs)}（范围 1000-600000 ms）`}
          >
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                id="sseHeartbeat"
                type="text"
                value={hbMs}
                onChange={(e) => onHbMsChange(parseNumericInput(e.target.value, hbMs))}
                className={inputClass(validity.hb)}
              />
              <span className="text-sm text-muted-foreground">ms</span>
              <Button size="sm" variant="outline" onClick={() => onHbMsChange(15000)}>重置</Button>
            </div>
          </SettingRow>

          <SettingRow
            title="上游最大空闲"
            description={`建议 ≥ 心跳间隔，当前约 ${msToSec(idleMs)}（范围 0-3600000 ms）`}
          >
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                id="providerMaxIdle"
                type="text"
                value={idleMs}
                onChange={(e) => onIdleMsChange(parseNumericInput(e.target.value, idleMs))}
                className={inputClass(validity.idle)}
              />
              <span className="text-sm text-muted-foreground">ms</span>
              <Button size="sm" variant="outline" onClick={() => onIdleMsChange(60000)}>重置</Button>
            </div>
          </SettingRow>

          <SettingRow
            title="推理初始宽限"
            description={`等待模型首帧前的最大空闲，当前约 ${msToSec(initialGraceMs)}（范围 0-3600000 ms）`}
          >
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                id="initialGrace"
                type="text"
                value={initialGraceMs}
                onChange={(e) => onInitialGraceMsChange(parseNumericInput(e.target.value, initialGraceMs))}
                className={inputClass(validity.initialGrace)}
              />
              <span className="text-sm text-muted-foreground">ms</span>
              <Button size="sm" variant="outline" onClick={() => onInitialGraceMsChange(120000)}>重置</Button>
            </div>
          </SettingRow>

          <SettingRow
            title="推理阶段空闲上限"
            description={`收到首帧后思考阶段的最长静默，当前约 ${msToSec(reasoningIdleMs)}（范围 0-3600000 ms）`}
          >
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                id="reasoningIdle"
                type="text"
                value={reasoningIdleMs}
                onChange={(e) => onReasoningIdleMsChange(parseNumericInput(e.target.value, reasoningIdleMs))}
                className={inputClass(validity.reasoningIdle)}
              />
              <span className="text-sm text-muted-foreground">ms</span>
              <Button size="sm" variant="outline" onClick={() => onReasoningIdleMsChange(300000)}>重置</Button>
            </div>
          </SettingRow>

          <SettingRow
            title="推理保活提示间隔"
            description={`大于 0 时在推理静默期间周期性发送“思考中”事件（范围 0-3600000 ms）`}
          >
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                id="keepalive"
                type="text"
                value={keepaliveMs}
                onChange={(e) => onKeepaliveMsChange(parseNumericInput(e.target.value, keepaliveMs))}
                className={inputClass(validity.keepalive)}
              />
              <span className="text-sm text-muted-foreground">ms</span>
              <Button size="sm" variant="outline" onClick={() => onKeepaliveMsChange(0)}>禁用</Button>
            </div>
          </SettingRow>

          <SettingRow
            title="上游总体超时"
            description={`整个请求的最长等待时间，当前约 ${msToSec(timeoutMs)}（范围 10000-3600000 ms）`}
          >
            <div className="flex w-full flex-wrap items-center justify-end gap-2">
              <Input
                id="providerTimeout"
                type="text"
                value={timeoutMs}
                onChange={(e) => onTimeoutMsChange(parseNumericInput(e.target.value, timeoutMs))}
                className={inputClass(validity.timeout)}
              />
              <span className="text-sm text-muted-foreground">ms</span>
              <Button size="sm" variant="outline" onClick={() => onTimeoutMsChange(300000)}>重置</Button>
            </div>
          </SettingRow>

          <SettingRow
            title="推送用量（usage）"
            description="开启后在流式过程中向前端发送 usage 事件"
          >
            <Switch checked={usageEmit} onCheckedChange={(v) => onUsageEmitChange(!!v)} />
          </SettingRow>

          <SettingRow
            title="仅透传厂商 usage"
            description="关闭时会在结束前估算 completion/total"
          >
            <Switch checked={usageProviderOnly} onCheckedChange={(v) => onUsageProviderOnlyChange(!!v)} disabled={!usageEmit} />
          </SettingRow>
        </>
      }
    />
  )
}
