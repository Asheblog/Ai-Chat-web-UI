"use client"

import { useEffect, useMemo, useState } from "react"
import { Image as ImageIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { SettingRow } from "@/components/settings/components/setting-row"
import { useSystemConnections } from "@/components/settings/system-connections/use-system-connections"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { getAggregatedModels } from "@/features/system/api"
import { deriveChannelName } from "@/lib/utils"
import type { ModelItem } from "@/store/models-store"
import type { SystemSettings } from "@/types"

export interface ImageTranscriptionCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 图片转写代理卡：主模型不支持识图时，将图片交给指定的识图模型转写为文字描述。
 * 使用 3 个 imageTranscription* key（enabled/connectionId/modelId），
 * 变更通过 update(patch) 即时提交；连接/模型下拉依赖 useSystemConnections + getAggregatedModels。
 */
export function ImageTranscriptionCard({ settings, update }: ImageTranscriptionCardProps) {
  const enabled = settings.imageTranscriptionEnabled === true
  const connectionId = settings.imageTranscriptionConnectionId ?? null
  const modelId = settings.imageTranscriptionModelId ?? null
  const { connections } = useSystemConnections()
  const [models, setModels] = useState<ModelItem[]>([])

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

  const toggle = (next: boolean) => update({ imageTranscriptionEnabled: next })
  const selectConnection = (value: string) =>
    update({ imageTranscriptionConnectionId: Number(value), imageTranscriptionModelId: null })
  const selectModel = (value: string) => update({ imageTranscriptionModelId: value })

  return (
    <FeatureCard
      icon={ImageIcon}
      title="图片转写代理"
      description="主模型不支持识图时，自动将图片交给指定的识图模型转写为文字描述，再回传给主模型。"
      cardKey="image-transcription:image-transcription"
      enabled={enabled}
      onEnabledChange={toggle}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">开关默认关闭；需选择转写模型后生效。</span>
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
          <CardTitle className="text-lg font-semibold tracking-tight leading-tight">图片转写代理</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            主模型不支持识图时，自动将图片交给指定的识图模型转写为文字描述
          </CardDescription>
        </div>
      </div>

      <ImageTranscriptionCard settings={settings} update={updateSystemSettings} />
    </div>
  )
}
