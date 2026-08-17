"use client"

import { useEffect, useMemo, useState } from "react"
import { Image as ImageIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import { useSystemConnections } from "@/components/settings/system-connections/use-system-connections"
import {
  probeImageTranscription,
  type ImageTranscriptionProbeResult,
} from "@/features/settings/api"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { getAggregatedModels } from "@/features/system/api"
import { deriveChannelName } from "@/lib/utils"
import type { ModelItem } from "@/store/models-store"
import type { SystemSettings } from "@/types"

const REASONING_EFFORT_OPTIONS = [
  { value: "unset", label: "unset" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "max", label: "max" },
  { value: "xhigh", label: "xhigh" },
] as const

const STEP_LABELS: Record<string, string> = {
  transcribe: "转写",
  relevance: "相关性",
}

export interface ImageTranscriptionCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 图片转写代理卡：主模型不支持识图时，将图片交给指定的识图模型转写为文字描述。
 * 使用 imageTranscription* key（enabled/connectionId/modelId + reasoning），
 * 变更通过 update(patch) 即时提交；连接/模型下拉依赖 useSystemConnections + getAggregatedModels。
 */
export function ImageTranscriptionCard({ settings, update }: ImageTranscriptionCardProps) {
  const { toast } = useToast()
  const enabled = settings.imageTranscriptionEnabled === true
  const connectionId = settings.imageTranscriptionConnectionId ?? null
  const modelId = settings.imageTranscriptionModelId ?? null
  const reasoningEnabled = settings.imageTranscriptionReasoningEnabled === true
  const reasoningEffort = settings.imageTranscriptionReasoningEffort || "unset"
  const ollamaThink = settings.imageTranscriptionOllamaThink === true
  const { connections } = useSystemConnections()
  const [models, setModels] = useState<ModelItem[]>([])
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<ImageTranscriptionProbeResult | null>(null)

  useEffect(() => {
    let alive = true
    getAggregatedModels()
      .then((res) => {
        if (!alive) return
        setModels(
          (res?.data ?? []).filter(
            (m: ModelItem) => m.capabilities?.vision === true && m.modelType !== "embedding",
          ),
        )
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const candidateModels = useMemo(
    () => models.filter((m) => m.connectionId === Number(connectionId)),
    [models, connectionId],
  )

  const canProbe = enabled && Boolean(connectionId) && Boolean(modelId) && !probing

  const toggle = (next: boolean) => update({ imageTranscriptionEnabled: next })
  const selectConnection = (value: string) =>
    update({ imageTranscriptionConnectionId: Number(value), imageTranscriptionModelId: null })
  const selectModel = (value: string) => update({ imageTranscriptionModelId: value })

  const handleProbe = async () => {
    if (!canProbe) return
    setProbing(true)
    setProbeResult(null)
    try {
      const response = await probeImageTranscription()
      const data = response.data
      if (!data) {
        throw new Error(response.error || "探针未返回结果")
      }
      setProbeResult(data)
    } catch (err: any) {
      const message =
        err?.response?.data?.error || err?.message || "测试转写代理失败"
      toast({ title: "测试失败", description: message, variant: "destructive" })
    } finally {
      setProbing(false)
    }
  }

  return (
    <FeatureCard
      icon={ImageIcon}
      title="图片转写代理"
      description="主模型不支持识图时，自动将图片交给指定的识图模型转写为文字描述，再回传给主模型。"
      cardKey="image-transcription:image-transcription"
      enabled={enabled}
      onEnabledChange={toggle}
      moreLabel="更多参数"
      more={
        <>
          <SettingRow title="思考模式" description="转写识图请求是否启用思考/推理链">
            <Switch
              checked={reasoningEnabled}
              onCheckedChange={(v) => update({ imageTranscriptionReasoningEnabled: !!v })}
              aria-label="思考模式"
            />
          </SettingRow>
          <SettingRow title="思考强度" description="OpenAI 兼容上游的 reasoning_effort">
            <Select
              value={reasoningEffort}
              onValueChange={(value) =>
                update({
                  imageTranscriptionReasoningEffort: value as SystemSettings["imageTranscriptionReasoningEffort"],
                })
              }
            >
              <SelectTrigger className="w-[220px]" aria-label="思考强度">
                <SelectValue placeholder="选择强度" />
              </SelectTrigger>
              <SelectContent>
                {REASONING_EFFORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow title="Ollama Think" description="上游为 Ollama 时按需启用 think">
            <Switch
              checked={ollamaThink}
              onCheckedChange={(v) => update({ imageTranscriptionOllamaThink: !!v })}
              aria-label="Ollama Think"
            />
          </SettingRow>
        </>
      }
      footer={
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              开关默认关闭；需选择转写模型后生效。可一键验证转写与相关性链路。
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canProbe}
              onClick={() => {
                void handleProbe()
              }}
            >
              {probing ? "测试中…" : "测试转写代理"}
            </Button>
          </div>
          {probeResult ? <ProbeResultPanel result={probeResult} /> : null}
        </div>
      }
    >
      <SettingRow title="转写连接" description="承载识图模型的系统连接">
        <Select value={connectionId ? String(connectionId) : ""} onValueChange={selectConnection}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="选择连接" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((conn) => (
              <SelectItem key={conn.id} value={String(conn.id)}>
                {deriveChannelName(conn.provider, conn.baseUrl)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow title="转写模型" description="仅列出该连接下具备识图能力的模型">
        <Select value={modelId ?? ""} onValueChange={selectModel}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder={connectionId ? "选择模型" : "请先选择连接"} />
          </SelectTrigger>
          <SelectContent>
            {candidateModels.map((m) => (
              <SelectItem key={m.id} value={m.rawId}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </FeatureCard>
  )
}

function ProbeResultPanel({ result }: { result: ImageTranscriptionProbeResult }) {
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-card/50 p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">探针结果</span>
        <Badge variant={result.ok ? "default" : "destructive"}>
          {result.ok ? "成功" : "失败"}
        </Badge>
      </div>
      <ul className="space-y-2">
        {result.steps.map((step) => (
          <li
            key={step.name}
            className="rounded-md border border-border/60 px-3 py-2 text-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">
                {STEP_LABELS[step.name] ?? step.name}
              </span>
              <span className="text-xs text-muted-foreground">{step.name}</span>
              <Badge variant={step.ok ? "outline" : "destructive"}>
                {step.ok ? "通过" : "未通过"}
              </Badge>
              <span className="text-xs text-muted-foreground">{step.durationMs} ms</span>
            </div>
            {step.detail ? (
              <p className="mt-1 break-words text-muted-foreground">{step.detail}</p>
            ) : null}
            {step.error ? (
              <p className="mt-1 break-words text-destructive">{step.error}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 图片转写代理叶子页：页壳 + 单卡组合（薄）。
 * 页壳仅做 useSystemSettings 的加载/错误层，卡片通过 update 即时提交。
 */
export function ImageTranscriptionPage() {
  const {
    settings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()

  useEffect(() => {
    fetchSystemSettings().catch(() => {})
  }, [fetchSystemSettings])

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
        <p>{error || "无法加载系统设置"}</p>
        <Button variant="outline" className="mt-3" onClick={() => fetchSystemSettings()}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 pb-3 border-b border-border/60">
        <ImageIcon className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="space-y-1">
          <CardTitle>图片转写代理</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            主模型不支持识图时，自动将图片交给指定的识图模型转写为文字描述
          </CardDescription>
        </div>
      </div>

      <ImageTranscriptionCard settings={settings} update={updateSystemSettings} />
    </div>
  )
}
