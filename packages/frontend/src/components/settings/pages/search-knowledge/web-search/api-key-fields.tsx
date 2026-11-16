"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { WebSearchEngine } from "@/types"
import { ENGINE_LABELS, ENGINE_OPTIONS } from "./web-search-constants"

export interface ApiKeyFieldsProps {
  drafts: Record<WebSearchEngine, string>
  clears: Record<WebSearchEngine, boolean>
  /** 该引擎当前是否已配置 Key（已考虑「待清除」） */
  hasKey: (engine: WebSearchEngine) => boolean
  onDraftChange: (engine: WebSearchEngine, value: string) => void
  onClear: (engine: WebSearchEngine) => void
}

/**
 * 五个搜索引擎的 Key 输入：留空表示不修改，显式清除会在保存时提交空串。
 * 凭据只写不读，因此这里只回显「已配置 / 未配置」。
 */
export function ApiKeyFields({ drafts, clears, hasKey, onDraftChange, onClear }: ApiKeyFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {ENGINE_OPTIONS.map((engine) => {
        const label = `${ENGINE_LABELS[engine.value]} API Key`
        const inputId = `web-search-key-${engine.value}`
        const configured = hasKey(engine.value)
        return (
          <div key={engine.value} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-semibold text-foreground" htmlFor={inputId}>
                {label}
              </label>
              <span className="text-xs text-ink-tertiary">
                {configured ? "已配置" : "未配置"}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={inputId}
                type="password"
                autoComplete="off"
                value={drafts[engine.value]}
                placeholder="留空表示不修改"
                onChange={(event) => onDraftChange(engine.value, event.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                aria-label={`清除 ${ENGINE_LABELS[engine.value]} Key`}
                onClick={() => onClear(engine.value)}
                disabled={!configured}
              >
                清除
              </Button>
            </div>
            {clears[engine.value] ? (
              <p className="text-xs text-destructive">
                保存后将删除 {ENGINE_LABELS[engine.value]} Key。
              </p>
            ) : null}
            {engine.value === "deepseek" ? (
              <p className="text-xs leading-5 text-ink-tertiary">
                清除后，如服务器仍配置了 DeepSeek 搜索密钥，将继续使用服务器密钥。
              </p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
