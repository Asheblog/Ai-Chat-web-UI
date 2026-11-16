"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ModelItem } from "@/store/models-store"
import { cn } from "@/lib/utils"
import { SettingRow } from "@/components/settings/components/setting-row"

export interface EmbeddingModelPickerProps {
  models: ModelItem[]
  isLoading: boolean
  connectionId: number | null
  modelId: string
  /** 没有专门的 embedding 模型时是否退化为展示全部模型 */
  hasEmbeddingModels: boolean
  onSelect: (model: ModelItem) => void
  onClear?: () => void
}

/**
 * Embedding 模型选择：连接与模型成对保存（connectionId + modelId），
 * 避免只清连接却留下孤儿 modelId 的脏值。
 */
export function EmbeddingModelPicker({
  models,
  isLoading,
  connectionId,
  modelId,
  hasEmbeddingModels,
  onSelect,
  onClear,
}: EmbeddingModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")

  const candidates = useMemo(() => {
    const embeddingOnly = models.filter((model) => {
      const type = model.modelType || "chat"
      return type === "embedding" || type === "both"
    })
    const source = embeddingOnly.length > 0 ? embeddingOnly : models
    const keyword = filter.trim().toLowerCase()
    if (!keyword) return source
    return source.filter((model) =>
      [model.id, model.rawId, model.name, model.provider, model.channelName].some((value) =>
        String(value || "").toLowerCase().includes(keyword),
      ),
    )
  }, [models, filter])

  const selected = useMemo(
    () => models.find((model) => model.connectionId === connectionId && model.id === modelId) || null,
    [models, connectionId, modelId],
  )

  const displayText = selected
    ? `${selected.name || selected.id}（${selected.provider || selected.channelName}）`
    : "未选择"

  return (
    <SettingRow
      title="Embedding 模型"
      description={
        hasEmbeddingModels
          ? "文档分块需要生成向量；从已配置的连接里选择支持 Embedding 的模型。"
          : "未检测到专门的 Embedding 模型，当前展示全部模型；缺少可用模型时文档解析不会启动。"
      }
      align="start"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label="选择 Embedding 模型"
              className="w-full justify-between font-normal"
            >
              <span className="truncate">{displayText}</span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(480px,90vw)] p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput placeholder="搜索模型..." value={filter} onValueChange={setFilter} />
              <CommandList className="max-h-[300px]">
                <CommandEmpty>{isLoading ? "加载中..." : "未找到匹配的模型"}</CommandEmpty>
                <CommandGroup>
                  {candidates.map((model) => {
                    const isSelected =
                      model.connectionId === connectionId && model.id === modelId
                    return (
                      <CommandItem
                        key={`${model.connectionId}:${model.id}`}
                        value={`${model.connectionId}:${model.id}`}
                        onSelect={() => {
                          onSelect(model)
                          setOpen(false)
                          setFilter("")
                        }}
                        className="flex items-center gap-2"
                      >
                        <Check
                          className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{model.name || model.id}</div>
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
        {onClear && (connectionId !== null || modelId) ? (
          <Button type="button" variant="outline" onClick={onClear}>
            取消选择
          </Button>
        ) : null}
      </div>
    </SettingRow>
  )
}
