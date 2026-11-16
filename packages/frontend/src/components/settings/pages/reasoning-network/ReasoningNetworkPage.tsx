"use client"

import { useEffect, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, BrainCircuit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useToast } from "@/components/ui/use-toast"
import { ReasoningConfigCard, type ReasoningEffort, type ReasoningTagsMode } from "./reasoning-config-card"
import { StreamPerformanceCard } from "./stream-performance-card"
import { NetworkCard } from "./network-card"

/** 自动生成上限的存储值：0 = 按模型与协议解析（shared/settings-service 缺省）。 */
const AUTO_MAX_OUTPUT_TOKENS = 0

const readMaxOutputTokensDraft = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? String(value) : ''

const readNumberDraft = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

/**
 * 生成与网络（高级）：数据与日志组的高级段。
 *
 * 页壳 = 单一 useSystemSettings + 共享骨架/错误重试，3 张 FeatureCard；
 * 整页单保存。默认展开层只留「推理识别 / 保存推理文本」这类用户真会改的开关，
 * 温度、生成上限、标签兼容、分片与超时一律收进各卡的「更多参数」。
 *
 * 保存失败必须让管理员看见：store 抛错，这里 toast 失败并保留输入，只有成功才提示已保存。
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
  const [saving, setSaving] = useState(false)

  // —— 推理与生成 ——
  const [reasoningEnabled, setReasoningEnabled] = useState(true)
  const [reasoningSaveToDb, setReasoningSaveToDb] = useState(true)
  const [reasoningTagsMode, setReasoningTagsMode] = useState<ReasoningTagsMode>('default')
  const [reasoningCustomTags, setReasoningCustomTags] = useState('')
  const [openaiReasoningEffort, setOpenaiReasoningEffort] = useState<ReasoningEffort>('unset')
  const [reasoningMaxTokens, setReasoningMaxTokens] = useState('')
  const [temperatureDefault, setTemperatureDefault] = useState('')

  // —— 流式与传输（keepalive 值保留但不下发控件）——
  const [streamDeltaChunkSize, setStreamDeltaChunkSize] = useState(1)
  const [streamDeltaFlushIntervalMs, setStreamDeltaFlushIntervalMs] = useState('')
  const [streamReasoningFlushIntervalMs, setStreamReasoningFlushIntervalMs] = useState('')

  // —— 网络与超时 ——
  const [hbMs, setHbMs] = useState(15000)
  const [timeoutMs, setTimeoutMs] = useState(120000)
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
    setReasoningTagsMode((settings.reasoningTagsMode as ReasoningTagsMode) || 'default')
    setReasoningCustomTags(settings.reasoningCustomTags || '')
    setOpenaiReasoningEffort(((settings.openaiReasoningEffort || 'unset') as ReasoningEffort))
    setReasoningMaxTokens(readMaxOutputTokensDraft(settings.reasoningMaxOutputTokensDefault))
    setTemperatureDefault(readNumberDraft(settings.temperatureDefault))
    setStreamDeltaChunkSize(Number(settings.streamDeltaChunkSize ?? 1))
    setStreamDeltaFlushIntervalMs(readNumberDraft(settings.streamDeltaFlushIntervalMs))
    setStreamReasoningFlushIntervalMs(readNumberDraft(settings.streamReasoningFlushIntervalMs))
    setHbMs(Number(settings.sseHeartbeatIntervalMs ?? 15000))
    setTimeoutMs(Number(settings.providerTimeoutMs ?? 120000))
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

  const within = (v: number, min: number, max: number) => v >= min && v <= max
  const hbValid = within(hbMs, 1000, 600000)
  const toutValid = within(timeoutMs, 10000, 3600000)
  const initialValid = within(initialGraceMs, 0, 3600000)
  const reasoningIdleValid = within(reasoningIdleMs, 0, 3600000)
  const keepaliveValid = within(keepaliveMs, 0, 3600000)
  const networkValid = hbValid && toutValid && initialValid && reasoningIdleValid && keepaliveValid

  // 整页 dirty 跟踪：任一可写字段与设置不同即 changed（keepalive 只读回填，不参与）
  const changed =
    reasoningEnabled !== Boolean(settings.reasoningEnabled ?? true) ||
    reasoningSaveToDb !== Boolean(settings.reasoningSaveToDb ?? true) ||
    reasoningTagsMode !== (settings.reasoningTagsMode || 'default') ||
    reasoningCustomTags !== (settings.reasoningCustomTags || '') ||
    openaiReasoningEffort !== (settings.openaiReasoningEffort || 'unset') ||
    reasoningMaxTokens !== readMaxOutputTokensDraft(settings.reasoningMaxOutputTokensDefault) ||
    temperatureDefault !== readNumberDraft(settings.temperatureDefault) ||
    streamDeltaChunkSize !== Number(settings.streamDeltaChunkSize ?? 1) ||
    streamDeltaFlushIntervalMs !== readNumberDraft(settings.streamDeltaFlushIntervalMs) ||
    streamReasoningFlushIntervalMs !== readNumberDraft(settings.streamReasoningFlushIntervalMs) ||
    hbMs !== Number(settings.sseHeartbeatIntervalMs ?? 15000) ||
    timeoutMs !== Number(settings.providerTimeoutMs ?? 120000) ||
    initialGraceMs !== Number(settings.providerInitialGraceMs ?? 120000) ||
    reasoningIdleMs !== Number(settings.providerReasoningIdleMs ?? 300000) ||
    keepaliveMs !== Number(settings.reasoningKeepaliveIntervalMs ?? 0)

  /** 空串 → 0（仅按分片触发）；非法 → 抛错由调用方提示 */
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

  const handleSave = async () => {
    if (!networkValid || saving) return

    const trimmedTags = reasoningCustomTags.trim()
    if (reasoningTagsMode === 'custom') {
      try {
        const arr = JSON.parse(trimmedTags)
        if (!Array.isArray(arr) || arr.length !== 2 || typeof arr[0] !== 'string' || typeof arr[1] !== 'string') {
          throw new Error('自定义标签需为 [startTag, endTag]')
        }
      } catch {
        toast({
          title: '自定义标签无效',
          description: '格式必须为 [" thinking","</think>"] 这样的 JSON 数组。',
          variant: 'destructive',
        })
        return
      }
    }

    let deltaFlushMs: number
    let reasoningFlushMs: number
    try {
      deltaFlushMs = parseInterval(streamDeltaFlushIntervalMs, '正文 flush 间隔')
      reasoningFlushMs = parseInterval(streamReasoningFlushIntervalMs, '推理 flush 间隔')
    } catch {
      return
    }

    // 生成上限：留空 = 自动（0），显式值保留
    const trimmedMaxTokens = reasoningMaxTokens.trim()
    let maxTokensValue = AUTO_MAX_OUTPUT_TOKENS
    if (trimmedMaxTokens !== '') {
      const parsed = Number.parseInt(trimmedMaxTokens, 10)
      if (!Number.isFinite(parsed) || parsed < 1) {
        toast({
          title: '默认生成上限无效',
          description: '请输入 1~256000 的整数，或留空表示自动按模型与协议解析',
          variant: 'destructive',
        })
        return
      }
      maxTokensValue = Math.min(256000, parsed)
    }

    const trimmedTemperature = temperatureDefault.trim()
    let temperatureValue: number | null = null
    if (trimmedTemperature !== '') {
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

    setSaving(true)
    try {
      await updateSystemSettings({
        reasoningEnabled,
        reasoningSaveToDb,
        reasoningTagsMode,
        reasoningCustomTags: trimmedTags,
        openaiReasoningEffort: openaiReasoningEffort !== 'unset' ? openaiReasoningEffort : 'unset',
        reasoningMaxOutputTokensDefault: maxTokensValue,
        temperatureDefault: temperatureValue,
        streamDeltaChunkSize,
        streamDeltaFlushIntervalMs: deltaFlushMs,
        streamReasoningFlushIntervalMs: reasoningFlushMs,
        // 传输保活没有控件：按当前生效值原样回写，避免整页保存把它改掉
        streamKeepaliveIntervalMs: Number(settings.streamKeepaliveIntervalMs ?? 0),
        sseHeartbeatIntervalMs: hbMs,
        providerTimeoutMs: timeoutMs,
        providerInitialGraceMs: initialGraceMs,
        providerReasoningIdleMs: reasoningIdleMs,
        reasoningKeepaliveIntervalMs: keepaliveMs,
      })
      toast({ title: '已保存生成与网络设置' })
    } catch (saveError: any) {
      toast({
        title: '保存失败',
        description: saveError?.response?.data?.error || saveError?.message || '生成与网络设置未能保存',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <BrainCircuit className="w-5 h-5 text-ink-tertiary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle>生成与网络</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            推理展示、默认生成参数与传输保活；属于高级设置，多数部署保持默认
          </CardDescription>
        </div>
      </div>

      <Alert className="v2-panel-soft border-border bg-surface">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          推理强度、温度与生成上限都有模型级配置，这里只是全局兜底；调整前请确认目标模型与反向代理支持。
        </AlertDescription>
      </Alert>

      <ReasoningConfigCard
        reasoningEnabled={reasoningEnabled}
        onReasoningEnabledChange={setReasoningEnabled}
        reasoningSaveToDb={reasoningSaveToDb}
        onReasoningSaveToDbChange={setReasoningSaveToDb}
        openaiReasoningEffort={openaiReasoningEffort}
        onOpenaiReasoningEffortChange={setOpenaiReasoningEffort}
        reasoningTagsMode={reasoningTagsMode}
        onReasoningTagsModeChange={setReasoningTagsMode}
        reasoningCustomTags={reasoningCustomTags}
        onReasoningCustomTagsChange={setReasoningCustomTags}
        reasoningMaxTokens={reasoningMaxTokens}
        onReasoningMaxTokensChange={setReasoningMaxTokens}
        temperatureDefault={temperatureDefault}
        onTemperatureDefaultChange={setTemperatureDefault}
      />
      <StreamPerformanceCard
        streamDeltaChunkSize={streamDeltaChunkSize}
        onStreamDeltaChunkSizeChange={setStreamDeltaChunkSize}
        streamDeltaFlushIntervalMs={streamDeltaFlushIntervalMs}
        onStreamDeltaFlushIntervalMsChange={setStreamDeltaFlushIntervalMs}
        streamReasoningFlushIntervalMs={streamReasoningFlushIntervalMs}
        onStreamReasoningFlushIntervalMsChange={setStreamReasoningFlushIntervalMs}
      />
      <NetworkCard
        hbMs={hbMs}
        onHbMsChange={setHbMs}
        initialGraceMs={initialGraceMs}
        onInitialGraceMsChange={setInitialGraceMs}
        reasoningIdleMs={reasoningIdleMs}
        onReasoningIdleMsChange={setReasoningIdleMs}
        keepaliveMs={keepaliveMs}
        onKeepaliveMsChange={setKeepaliveMs}
        timeoutMs={timeoutMs}
        onTimeoutMsChange={setTimeoutMs}
        validity={{
          hb: hbValid,
          initialGrace: initialValid,
          reasoningIdle: reasoningIdleValid,
          keepalive: keepaliveValid,
          timeout: toutValid,
        }}
      />

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={isLoading || saving || !changed || !networkValid}>
          {saving ? '保存中...' : '保存设置'}
        </Button>
      </div>
    </div>
  )
}
