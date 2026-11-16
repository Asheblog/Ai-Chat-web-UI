"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { WebSearchEngine } from "@/types"
import { ENGINE_OPTIONS } from "./web-search-constants"

export interface EngineSelectionProps {
  /** 有序启用引擎列表：数组顺序即并行调度优先级 */
  engines: WebSearchEngine[]
  /** 引擎当前是否已配置可用 Key（含待清除判断） */
  hasKey: (engine: WebSearchEngine) => boolean
  onToggle: (engine: WebSearchEngine, enabled: boolean) => void
  onMove: (engine: WebSearchEngine, direction: "up" | "down") => void
}

/**
 * 启用搜索引擎：一个列表同时表达「启用集合」与「优先顺序」。
 * 勾选加入列表末尾，取消勾选移出；上下移动改的就是检索时的调度优先级。
 */
export function EngineSelection({ engines, hasKey, onToggle, onMove }: EngineSelectionProps) {
  const missingKeys = engines.filter((engine) => !hasKey(engine))

  return (
    <div className="space-y-3" role="group" aria-label="启用搜索引擎（列表顺序即检索优先级）">
      <div>
        <p className="text-sm font-semibold leading-6 text-foreground">启用搜索引擎</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
          勾选即启用；列表从上到下就是多引擎并行与结果融合的优先顺序。至少保留一个引擎。
        </p>
      </div>

      <ul className="space-y-2">
        {ENGINE_OPTIONS.map((engine) => {
          const enabled = engines.includes(engine.value)
          const index = engines.indexOf(engine.value)
          const keyReady = hasKey(engine.value)
          return (
            <li
              key={engine.value}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2",
                enabled ? "bg-surface" : "bg-transparent",
              )}
            >
              <Checkbox
                id={`web-search-engine-${engine.value}`}
                checked={enabled}
                aria-label={engine.label}
                onCheckedChange={(value) => onToggle(engine.value, value === true)}
              />
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`web-search-engine-${engine.value}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground"
                >
                  <span className="font-medium">{engine.label}</span>
                  {enabled ? (
                    <span className="text-xs text-ink-tertiary">#{index + 1}</span>
                  ) : null}
                  <span
                    className={cn(
                      "text-xs",
                      keyReady ? "text-ink-tertiary" : "text-destructive",
                    )}
                  >
                    {keyReady ? "已配置 Key" : "未配置 Key"}
                  </span>
                </label>
                {enabled && !keyReady ? (
                  <p className="mt-0.5 text-xs leading-5 text-destructive">
                    运行时没有可用 Key 的引擎会被直接跳过，这里只是启用意向。
                  </p>
                ) : null}
              </div>
              {enabled ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    onClick={() => onMove(engine.value, "up")}
                    disabled={index <= 0}
                    aria-label={`上移 ${engine.label}`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    onClick={() => onMove(engine.value, "down")}
                    disabled={index === engines.length - 1}
                    aria-label={`下移 ${engine.label}`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {engines.length === 0 ? (
        <p className="text-xs text-destructive">至少需要启用一个搜索引擎。</p>
      ) : null}
      {engines.length > 0 && missingKeys.length === engines.length ? (
        <p className="text-xs leading-5 text-destructive">
          已启用的引擎都还没有配置 Key，联网搜索不会真正执行。请在下方填写对应 Key。
        </p>
      ) : null}
    </div>
  )
}
