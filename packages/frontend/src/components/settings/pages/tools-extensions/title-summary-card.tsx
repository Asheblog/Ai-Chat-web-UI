"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, ChevronsUpDown, Type } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SettingRow } from "@/components/settings/components/setting-row"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import { useModelsStore, type ModelItem } from "@/store/models-store"
import { cn } from "@/lib/utils"
import type { SystemSettings } from "@/types"

export interface TitleSummaryCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
}

/**
 * 标题智能总结卡：启用、标题长度与模型来源。
 *
 * 「指定模型」不再是伪选项：选择器按连接 + 模型成对保存，`titleSummaryModelId` 存模型线路身份
 * （rawId），与后端「当前会话模型」分支使用同一字段含义；切回「当前会话模型」会清空这两个 id。
 */
export function TitleSummaryCard({ settings, update }: TitleSummaryCardProps) {
  const { toast } = useToast()
  const { models, isLoading: modelsLoading, fetchAll: fetchModels } = useModelsStore()

  const [enabled, setEnabled] = useState(false)
  const [maxLength, setMaxLength] = useState(20)
  const [modelSource, setModelSource] = useState<"current" | "specified">("current")
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [modelId, setModelId] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchModels().catch(() => {})
  }, [fetchModels])

  const resetDrafts = useCallback(() => {
    setEnabled(Boolean(settings.titleSummaryEnabled))
    setMaxLength(settings.titleSummaryMaxLength ?? 20)
    setModelSource(settings.titleSummaryModelSource ?? "current")
    setConnectionId(settings.titleSummaryConnectionId ?? null)
    setModelId(settings.titleSummaryModelId ?? "")
  }, [settings])

  useEffect(() => {
    resetDrafts()
  }, [resetDrafts])

  const selectedModel = useMemo(
    () =>
      models.find(
        (model) => model.connectionId === connectionId && model.rawId === modelId,
      ) ?? null,
    [models, connectionId, modelId],
  )

  const candidates = useMemo(() => {
    const keyword = filter.trim().toLowerCase()
    if (!keyword) return models
    return models.filter((model) =>
      [model.id, model.rawId, model.name, model.provider, model.channelName].some((value) =>
        String(value || "").toLowerCase().includes(keyword),
      ),
    )
  }, [models, filter])

  const specifiedReady = connectionId !== null && modelId !== ""
  const valid = modelSource === "current" || specifiedReady

  const changed =
    enabled !== Boolean(settings.titleSummaryEnabled) ||
    maxLength !== (settings.titleSummaryMaxLength ?? 20) ||
    modelSource !== (settings.titleSummaryModelSource ?? "current") ||
    connectionId !== (settings.titleSummaryConnectionId ?? null) ||
    modelId !== (settings.titleSummaryModelId ?? "")

  const handleModelSelect = (model: ModelItem) => {
    setConnectionId(model.connectionId)
    setModelId(model.rawId)
    setPickerOpen(false)
    setFilter("")
  }

  const handleSave = async () => {
    if (!valid || saving) return
    const useSpecified = modelSource === "specified"
    setSaving(true)
    try {
      await update({
        titleSummaryEnabled: enabled,
        titleSummaryMaxLength: maxLength,
        titleSummaryModelSource: modelSource,
        titleSummaryConnectionId: useSpecified ? connectionId : null,
        titleSummaryModelId: useSpecified ? modelId : null,
      })
      toast({ title: "标题总结设置已保存" })
    } catch (error) {
      toast({
        title: "标题总结设置保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const displayText = selectedModel
    ? `${selectedModel.name || selectedModel.rawId}（${selectedModel.provider || selectedModel.channelName}）`
    : "未选择模型"

  return (
    <FeatureCard
      icon={Type}
      title="标题智能总结"
      description="使用 AI 自动为对话生成简洁标题"
      cardKey="extensions:title-summary"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={resetDrafts} disabled={!changed}>
            还原更改
          </Button>
          <Button onClick={handleSave} disabled={!changed || !valid || saving}>
            {saving ? "保存中..." : "保存标题总结设置"}
          </Button>
        </div>
      }
    >
      <SettingRow
        title={(
          <div className="flex items-center gap-2">
            启用智能标题
            <Badge className="bg-ink-tertiary/10 text-ink-tertiary">实验性</Badge>
          </div>
        )}
        description="发送首条消息时自动调用模型生成对话标题"
      >
        {(descriptionId) => (
          <Switch
            id="titleSummaryEnabled"
            aria-describedby={descriptionId}
            checked={enabled}
            onCheckedChange={(checked) => setEnabled(Boolean(checked))}
          />
        )}
      </SettingRow>

      <SettingRow
        title="标题最大长度"
        description="生成的标题字数限制（5-50 字）"
        htmlFor="titleSummaryMaxLength"
      >
        <div className="flex items-center justify-end gap-2">
          <Input
            id="titleSummaryMaxLength"
            type="text"
            inputMode="numeric"
            value={maxLength}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10)
              if (!Number.isNaN(parsed)) setMaxLength(Math.max(5, Math.min(50, parsed)))
            }}
            className="w-full text-right sm:w-28"
            disabled={!enabled}
          />
          <span className="whitespace-nowrap text-sm text-ink-tertiary">字</span>
        </div>
      </SettingRow>

      <SettingRow
        title="模型来源"
        description="用当前会话模型，或固定一个专用模型生成标题。"
        htmlFor="titleSummaryModelSource"
      >
        <Select
          value={modelSource}
          onValueChange={(value) => setModelSource(value as "current" | "specified")}
          disabled={!enabled}
        >
          <SelectTrigger id="titleSummaryModelSource">
            <SelectValue placeholder="选择模型来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="current">使用当前会话模型</SelectItem>
            <SelectItem value="specified">指定模型</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      {modelSource === "specified" ? (
        <SettingRow
          title="标题模型"
          description="连接与模型成对保存；未选择时无法保存，避免静默回落到会话模型。"
          align="start"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  aria-label="选择标题模型"
                  className="w-full justify-between font-normal"
                  disabled={!enabled}
                >
                  <span className="truncate">{displayText}</span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(480px,90vw)] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput placeholder="搜索模型..." value={filter} onValueChange={setFilter} />
                  <CommandList className="max-h-[300px]">
                    <CommandEmpty>{modelsLoading ? "加载中..." : "未找到匹配的模型"}</CommandEmpty>
                    <CommandGroup>
                      {candidates.map((model) => {
                        const isSelected =
                          model.connectionId === connectionId && model.rawId === modelId
                        return (
                          <CommandItem
                            key={`${model.connectionId}:${model.id}`}
                            value={`${model.connectionId}:${model.id}`}
                            onSelect={() => handleModelSelect(model)}
                            className="flex items-center gap-2"
                          >
                            <Check
                              className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{model.name || model.rawId}</div>
                              <div className="truncate text-xs text-ink-tertiary">
                                {model.provider || model.channelName} · {model.rawId}
                              </div>
                            </div>
                          </CommandItem>
                        )
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          {!specifiedReady ? (
            <p className="mt-2 text-xs leading-5 text-destructive">
              请选择一个具体模型；只有连接没有模型时不会保存。
            </p>
          ) : null}
        </SettingRow>
      ) : null}
    </FeatureCard>
  )
}
