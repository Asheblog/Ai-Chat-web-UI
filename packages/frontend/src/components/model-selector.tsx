"use client"

import { useState, useEffect } from "react"
import { Check, ChevronDown } from "lucide-react"
import { useModelsStore, type ModelItem } from "@/store/models-store"
import { cn, deriveChannelName } from "@/lib/utils"
import { modelKeyFor } from "@/store/model-preference-store"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Skeleton } from "@/components/ui/skeleton"

interface ModelSelectorProps {
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
  disabled?: boolean
  className?: string
  variant?: "default" | "inline"
}

export function ModelSelector({ selectedModelId, onModelChange, disabled, className, variant = "default" }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const { models: allModels, isLoading: loading, fetchAll } = useModelsStore()
  const modelsCount = allModels.length
  useEffect(() => {
    if (modelsCount === 0) {
      fetchAll().catch(() => {})
    }
  }, [modelsCount, fetchAll])

  const selected = allModels.find((m) => {
    if (!selectedModelId) return false
    if (m.id === selectedModelId) return true
    if (m.rawId && m.rawId === selectedModelId) return true
    return modelKeyFor(m) === selectedModelId
  })

  const trigger = (
    <Button
      type="button"
      variant="outline"
      role="combobox"
      aria-expanded={open}
      aria-label="选择模型"
      disabled={disabled}
      className={cn(
        "border-none shadow-none bg-background/80 hover:bg-accent/80",
        variant === "inline" ? "h-10 w-10 px-0 justify-center" : "min-w-[220px] justify-between",
        className
      )}
    >
      {variant === "inline" ? (
        <ChevronDown className={cn("h-4 w-4 transition-transform", open ? "rotate-180" : "")} />
      ) : (
        <>
          <span className="truncate mr-2">{selected ? selected.name : "选择模型"}</span>
          <ChevronDown
            className={cn(
              "ml-auto h-4 w-4 opacity-70 transition-transform",
              open ? "rotate-180" : ""
            )}
          />
        </>
      )}
    </Button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="p-0 w-72">
        <Command>
          <CommandInput placeholder="搜索模型..." />
          <CommandList>
            {loading && (
              <div className="p-2 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 p-2">
                    <Skeleton className="h-4 w-4 rounded" />
                    <div className="flex-1">
                      <Skeleton className="h-3 w-40" />
                      <Skeleton className="mt-1 h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && <CommandEmpty>暂无可用模型</CommandEmpty>}
            <CommandGroup heading="全部模型">
              {allModels.map((model) => {
                const key = modelKeyFor(model)
                const isActive = Boolean(
                  selectedModelId && (
                    selectedModelId === model.id ||
                    selectedModelId === key ||
                    (!!model.rawId && selectedModelId === model.rawId)
                  )
                )
                const channel = model.channelName || deriveChannelName(model.provider, model.connectionBaseUrl)
                return (
                  <CommandItem
                    key={`${model.connectionId}:${model.id}`}
                    value={`${model.name} ${model.id}`}
                    onSelect={() => {
                      onModelChange(model)
                      setOpen(false)
                    }}
                    className="px-3"
                  >
                    <div className="flex flex-col flex-1 min-w-0 text-left">
                      <span className="text-sm font-medium leading-none truncate">{model.name}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        渠道商 | {channel}
                      </span>
                    </div>
                    {isActive && <Check className="ml-2 h-4 w-4 flex-shrink-0 text-primary" />}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
