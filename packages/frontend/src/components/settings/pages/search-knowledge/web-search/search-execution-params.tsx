"use client"

import { Input } from "@/components/ui/input"
import { WEB_SEARCH_RANGES } from "./web-search-constants"

export interface SearchExecutionValues {
  parallelMaxEngines: number
  parallelMaxQueriesPerCall: number
  parallelTimeoutMs: number
  autoReadParallelism: number
  autoReadBatchTimeoutMs: number
}

export interface SearchExecutionParamsProps {
  values: SearchExecutionValues
  invalid: Partial<Record<keyof SearchExecutionValues, boolean>>
  /** 单次调用查询扩展数固定为 1 时，双语扩展不会生效 */
  bilingualBlocked: boolean
  onChange: (key: keyof SearchExecutionValues, value: number, previous: number) => void
}

const parseNumeric = (raw: string, previous: number) => {
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? previous : parsed
}

/**
 * 搜索执行参数：默认收在「更多参数」里，属于资源与延迟调优而非日常配置。
 * 双语扩展依赖「单次调用查询扩展数 > 1」，这里显式给出依赖提示，避免调成 1 后误以为双语失效。
 */
export function SearchExecutionParams({
  values,
  invalid,
  bilingualBlocked,
  onChange,
}: SearchExecutionParamsProps) {
  const fields: Array<{
    key: keyof SearchExecutionValues
    label: string
    hint: string
  }> = [
    {
      key: "parallelMaxEngines",
      label: "并行引擎上限",
      hint: `一次检索最多并行几个引擎（${WEB_SEARCH_RANGES.parallelMaxEngines.min}-${WEB_SEARCH_RANGES.parallelMaxEngines.max}），不会超过已启用引擎数。`,
    },
    {
      key: "parallelMaxQueriesPerCall",
      label: "单次调用查询扩展数",
      hint: `一次工具调用最多展开几条查询（${WEB_SEARCH_RANGES.parallelMaxQueriesPerCall.min}-${WEB_SEARCH_RANGES.parallelMaxQueriesPerCall.max}）；双语扩展需要大于 1。`,
    },
    {
      key: "parallelTimeoutMs",
      label: "并行检索超时（毫秒）",
      hint: `单轮并行检索的总时限（${WEB_SEARCH_RANGES.parallelTimeoutMs.min}-${WEB_SEARCH_RANGES.parallelTimeoutMs.max}）。`,
    },
    {
      key: "autoReadParallelism",
      label: "自动网页读取并发",
      hint: `同时读取几个网页正文（${WEB_SEARCH_RANGES.autoReadParallelism.min}-${WEB_SEARCH_RANGES.autoReadParallelism.max}）。`,
    },
    {
      key: "autoReadBatchTimeoutMs",
      label: "自动阅读批次总时限（毫秒）",
      hint: `整批自动阅读（含排队与替补）的总时限（${WEB_SEARCH_RANGES.autoReadBatchTimeoutMs.min}-${WEB_SEARCH_RANGES.autoReadBatchTimeoutMs.max}），与单页读取超时分别生效。`,
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold leading-6 text-foreground">搜索执行参数</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
          影响检索延迟与并发占用，默认值适用于大多数部署。
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-foreground" htmlFor={`web-search-${field.key}`}>
              {field.label}
            </label>
            <Input
              id={`web-search-${field.key}`}
              type="text"
              inputMode="numeric"
              value={values[field.key]}
              onChange={(event) =>
                onChange(field.key, parseNumeric(event.target.value, values[field.key]), values[field.key])
              }
              className={invalid[field.key] ? "border-destructive" : undefined}
            />
            <p className="text-xs leading-5 text-ink-tertiary">{field.hint}</p>
          </div>
        ))}
      </div>
      {bilingualBlocked ? (
        <p className="text-xs leading-5 text-destructive">
          单次调用查询扩展数为 1：双语扩展不会生效，请调大该值或关闭双语扩展。
        </p>
      ) : null}
    </div>
  )
}
