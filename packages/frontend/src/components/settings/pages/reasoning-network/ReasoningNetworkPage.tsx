"use client"

import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, BrainCircuit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useToast } from "@/components/ui/use-toast"
import { ReasoningConfigCard } from "./reasoning-config-card"
import { StreamPerformanceCard } from "./stream-performance-card"
import { OllamaCard } from "./ollama-card"
import { NetworkCard } from "./network-card"

/**
 * 推理与网络页：页壳（单一 useSystemSettings + 共享骨架/错误重试），
 * 4 张 FeatureCard 分区 + 整页单保存（payload = 12 reasoning + 8 network = 20 key）。
 * 旧 SystemReasoning / SystemNetwork 两页合并而来。
 */
export function ReasoningNetworkPage() {
  const {
    settings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()
  const { toast } = useToast()

  // —— 推理链（12 key）——
  const [reasoningEnabled, setReasoningEnabled] = useState(true)
  const [reasoningSaveToDb, setReasoningSaveToDb] = useState(true)
  const [reasoningTagsMode, setReasoningTagsMode] = useState<'default' | 'custom' | 'off'>('default')
  const [reasoningCustomTags, setReasoningCustomTags] = useState('')
  const [reasoningMaxTokens, setReasoningMaxTokens] = useState('')
  const [temperatureDefault, setTemperatureDefault] = useState('')
  const [streamDeltaChunkSize, setStreamDeltaChunkSize] = useState(1)
  const [streamDeltaFlushIntervalMs, setStreamDeltaFlushIntervalMs] = useState('')
  const [streamReasoningFlushIntervalMs, setStreamReasoningFlushIntervalMs] = useState('')
  const [streamKeepaliveIntervalMs, setStreamKeepaliveIntervalMs] = useState('')
  const [openaiReasoningEffort, setOpenaiReasoningEffort] = useState<'unset' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'>('unset')
  const [ollamaThink, setOllamaThink] = useState(false)

  // —— 网络与超时（8 key）——
  const [hbMs, setHbMs] = useState(15000)
  const [idleMs, setIdleMs] = useState(60000)
  const [timeoutMs, setTimeoutMs] = useState(300000)
  const [usageEmit, setUsageEmit] = useState(true)
  const [usageProviderOnly, setUsageProviderOnly] = useState(false)
  const [initialGraceMs, setInitialGraceMs] = useState(120000)
  const [reasoningIdleMs, setReasoningIdleMs] = useState(300000)
  const [keepaliveMs, setKeepaliveMs] = useState(0)

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

  useEffect(() => {
    if (!settings) return
    setReasoningEnabled(Boolean(settings.reasoningEnabled ?? true))
    setReasoningSaveToDb(Boolean(settings.reasoningSaveToDb ?? true))
    setReasoningTagsMode((settings.reasoningTagsMode as any) || 'default')
    setReasoningCustomTags(settings.reasoningCustomTags || '')
    setStreamDeltaChunkSize(Number(settings.streamDeltaChunkSize ?? 1))
    setStreamDeltaFlushIntervalMs(
      settings.streamDeltaFlushIntervalMs != null ? String(settings.streamDeltaFlushIntervalMs) : ''
    )
    setStreamReasoningFlushIntervalMs(
      settings.streamReasoningFlushIntervalMs != null ? String(settings.streamReasoningFlushIntervalMs) : ''
    )
    setStreamKeepaliveIntervalMs(
      settings.streamKeepaliveIntervalMs != null ? String(settings.streamKeepaliveIntervalMs) : ''
    )
    setOpenaiReasoningEffort(((settings as any).openaiReasoningEffort || 'unset') as any)
    setOllamaThink(Boolean((settings as any).ollamaThink ?? false))
    const sysMaxTokens = settings?.reasoningMaxOutputTokensDefault
    setReasoningMaxTokens(typeof sysMaxTokens === 'number' ? String(sysMaxTokens) : '')
    const sysTemperature = settings?.temperatureDefault
    setTemperatureDefault(typeof sysTemperature === 'number' ? String(sysTemperature) : '')
    setHbMs(Number(settings.sseHeartbeatIntervalMs ?? 15000))
    setIdleMs(Number(settings.providerMaxIdleMs ?? 60000))
    setTimeoutMs(Number(settings.providerTimeoutMs ?? 300000))
    setUsageEmit(Boolean(settings.usageEmit ?? true))
    setUsageProviderOnly(Boolean(settings.usageProviderOnly ?? false))
    setInitialGraceMs(Number(settings.providerInitialGraceMs ?? 120000))
    setReasoningIdleMs(Number(settings.providerReasoningIdleMs ?? 300000))
    setKeepaliveMs(Number(settings.reasoningKeepaliveIntervalMs ?? 0))
  }, [settings])

  if (isLoading && !settings) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || '无法加载系统设置'}</p>
        <Button variant="outline" className="mt-3" onClick={() => fetchSystemSettings()}>
          重试
        </Button>
      </div>
    )
  }

  // —— 网络各范围（源 SystemNetwork 79-90）——
  const within = (v: number, min: number, max: number) => v >= min && v <= max
  const hbValid = within(hbMs, 1000, 600000)
  const idleValid = within(idleMs, 0, 3600000)
  const toutValid = within(timeoutMs, 10000, 3600000)
  const initialValid = within(initialGraceMs, 0, 3600000)
  const reasoningIdleValid = within(reasoningIdleMs, 0, 3600000)
  const keepaliveValid = within(keepaliveMs, 0, 3600000)
  const networkValid =
    hbValid && idleValid && toutValid && initialValid && reasoningIdleValid && keepaliveValid

  // —— 整页 dirty 跟踪（20 key 任一与 settings 不同即 changed）——
  const changed =
    reasoningEnabled !== Boolean(settings.reasoningEnabled ?? true) ||
    reasoningSaveToDb !== Boolean(settings.reasoningSaveToDb ?? true) ||
    reasoningTagsMode !== (settings.reasoningTagsMode || 'default') ||
    reasoningCustomTags !== (settings.reasoningCustomTags || '') ||
    streamDeltaChunkSize !== Number(settings.streamDeltaChunkSize ?? 1) ||
    streamDeltaFlushIntervalMs !==
      (settings.streamDeltaFlushIntervalMs != null ? String(settings.streamDeltaFlushIntervalMs) : '') ||
    streamReasoningFlushIntervalMs !==
      (settings.streamReasoningFlushIntervalMs != null ? String(settings.streamReasoningFlushIntervalMs) : '') ||
    streamKeepaliveIntervalMs !==
      (settings.streamKeepaliveIntervalMs != null ? String(settings.streamKeepaliveIntervalMs) : '') ||
    openaiReasoningEffort !== (settings.openaiReasoningEffort || 'unset') ||
    ollamaThink !== Boolean(settings.ollamaThink ?? false) ||
    reasoningMaxTokens !==
      (typeof settings.reasoningMaxOutputTokensDefault === 'number' ? String(settings.reasoningMaxOutputTokensDefault) : '') ||
    temperatureDefault !==
      (typeof settings.temperatureDefault === 'number' ? String(settings.temperatureDefault) : '') ||
    hbMs !== Number(settings.sseHeartbeatIntervalMs ?? 15000) ||
    idleMs !== Number(settings.providerMaxIdleMs ?? 60000) ||
    timeoutMs !== Number(settings.providerTimeoutMs ?? 300000) ||
    initialGraceMs !== Number(settings.providerInitialGraceMs ?? 120000) ||
    reasoningIdleMs !== Number(settings.providerReasoningIdleMs ?? 300000) ||
    keepaliveMs !== Number(settings.reasoningKeepaliveIntervalMs ?? 0) ||
    usageEmit !== Boolean(settings.usageEmit ?? true) ||
    usageProviderOnly !== Boolean(settings.usageProviderOnly ?? false)

  const handleSave = async () => {
    if (!networkValid) return

    if (reasoningTagsMode === 'custom') {
      try {
        const arr = JSON.parse(reasoningCustomTags)
        if (!Array.isArray(arr) || arr.length !== 2 || typeof arr[0] !== 'string' || typeof arr[1] !== 'string') {
          throw new Error('自定义标签需为 [startTag, endTag]')
        }
      } catch (e) {
        toast({
          title: '自定义标签无效',
          description: '格式必须为 ["<think>","</think>"] 这样的 JSON 数组。',
          variant: 'destructive',
        })
        return
      }
    }

    const parseInterval = (raw: string, label: string) => {
      const trimmed = raw.trim()
      if (trimmed === '') return 0
      const parsed = Number.parseInt(trimmed, 10)
      if (!Number.isFinite(parsed) || parsed < 0) {
        toast({
          title: `${label}无效`,
          description: '请输入大于等于 0 的整数',
          variant: 'destructive',
        })
        throw new Error('invalid')
      }
      return parsed
    }
    let deltaFlushMs: number
    let reasoningFlushMs: number
    let keepaliveFlushMs: number
    try {
      deltaFlushMs = parseInterval(streamDeltaFlushIntervalMs, '正文 flush 间隔')
      reasoningFlushMs = parseInterval(streamReasoningFlushIntervalMs, '推理 flush 间隔')
      keepaliveFlushMs = parseInterval(streamKeepaliveIntervalMs, 'Keepalive 间隔')
    } catch {
      return
    }

    let maxTokensValue: number | null
    const trimmedMaxTokens = reasoningMaxTokens.trim()
    if (trimmedMaxTokens === '') {
      maxTokensValue = null
    } else {
      const parsed = Number.parseInt(trimmedMaxTokens, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        toast({
          title: '默认生成 Tokens 无效',
          description: '请输入 1~256000 的整数，或留空表示使用默认值（32K）',
          variant: 'destructive',
        })
        return
      }
      maxTokensValue = Math.min(256000, parsed)
    }

    let temperatureValue: number | null
    const trimmedTemperature = temperatureDefault.trim()
    if (trimmedTemperature === '') {
      temperatureValue = null
    } else {
      const parsed = Number.parseFloat(trimmedTemperature)
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
        toast({
          title: '默认温度无效',
          description: '请输入 0~2 的数字，或留空表示默认值（0.7）',
          variant: 'destructive',
        })
        return
      }
      temperatureValue = parsed
    }

    await updateSystemSettings({
      reasoningEnabled,
      reasoningSaveToDb,
      reasoningTagsMode,
      reasoningCustomTags,
      streamDeltaChunkSize,
      streamDeltaFlushIntervalMs: deltaFlushMs,
      streamReasoningFlushIntervalMs: reasoningFlushMs,
      streamKeepaliveIntervalMs: keepaliveFlushMs,
      openaiReasoningEffort: openaiReasoningEffort !== 'unset' ? openaiReasoningEffort : 'unset',
      reasoningMaxOutputTokensDefault: maxTokensValue,
      temperatureDefault: temperatureValue,
      ollamaThink,
      sseHeartbeatIntervalMs: hbMs,
      providerMaxIdleMs: idleMs,
      providerTimeoutMs: timeoutMs,
      providerInitialGraceMs: initialGraceMs,
      providerReasoningIdleMs: reasoningIdleMs,
      reasoningKeepaliveIntervalMs: keepaliveMs,
      usageEmit,
      usageProviderOnly,
    } as any)
    toast({ title: '已保存推理与网络设置' })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <BrainCircuit className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle>推理与网络</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            控制推理链、流式输出与网络连接参数
          </CardDescription>
        </div>
      </div>

      <Alert className="v2-panel-soft border-border bg-background/78">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>这里保持默认即可，调整前请确认你了解这些参数的影响。</AlertDescription>
      </Alert>

      <ReasoningConfigCard
        reasoningEnabled={reasoningEnabled}
        onReasoningEnabledChange={setReasoningEnabled}
        reasoningSaveToDb={reasoningSaveToDb}
        onReasoningSaveToDbChange={setReasoningSaveToDb}
        reasoningMaxTokens={reasoningMaxTokens}
        onReasoningMaxTokensChange={setReasoningMaxTokens}
        temperatureDefault={temperatureDefault}
        onTemperatureDefaultChange={setTemperatureDefault}
        reasoningTagsMode={reasoningTagsMode}
        onReasoningTagsModeChange={setReasoningTagsMode}
        reasoningCustomTags={reasoningCustomTags}
        onReasoningCustomTagsChange={setReasoningCustomTags}
      />
      <StreamPerformanceCard
        streamDeltaChunkSize={streamDeltaChunkSize}
        onStreamDeltaChunkSizeChange={setStreamDeltaChunkSize}
        streamDeltaFlushIntervalMs={streamDeltaFlushIntervalMs}
        onStreamDeltaFlushIntervalMsChange={setStreamDeltaFlushIntervalMs}
        streamReasoningFlushIntervalMs={streamReasoningFlushIntervalMs}
        onStreamReasoningFlushIntervalMsChange={setStreamReasoningFlushIntervalMs}
        streamKeepaliveIntervalMs={streamKeepaliveIntervalMs}
        onStreamKeepaliveIntervalMsChange={setStreamKeepaliveIntervalMs}
        openaiReasoningEffort={openaiReasoningEffort}
        onOpenaiReasoningEffortChange={setOpenaiReasoningEffort}
      />
      <OllamaCard ollamaThink={ollamaThink} onOllamaThinkChange={setOllamaThink} />
      <NetworkCard
        hbMs={hbMs}
        onHbMsChange={setHbMs}
        idleMs={idleMs}
        onIdleMsChange={setIdleMs}
        initialGraceMs={initialGraceMs}
        onInitialGraceMsChange={setInitialGraceMs}
        reasoningIdleMs={reasoningIdleMs}
        onReasoningIdleMsChange={setReasoningIdleMs}
        keepaliveMs={keepaliveMs}
        onKeepaliveMsChange={setKeepaliveMs}
        timeoutMs={timeoutMs}
        onTimeoutMsChange={setTimeoutMs}
        usageEmit={usageEmit}
        onUsageEmitChange={setUsageEmit}
        usageProviderOnly={usageProviderOnly}
        onUsageProviderOnlyChange={setUsageProviderOnly}
        validity={{ hb: hbValid, idle: idleValid, initialGrace: initialValid, reasoningIdle: reasoningIdleValid, keepalive: keepaliveValid, timeout: toutValid }}
      />

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={isLoading || !changed || !networkValid}>
          保存设置
        </Button>
      </div>
    </div>
  )
}
