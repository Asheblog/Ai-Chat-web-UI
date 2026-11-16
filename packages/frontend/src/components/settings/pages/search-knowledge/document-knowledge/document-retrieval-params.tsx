"use client"

import { Input } from "@/components/ui/input"
import { SettingRow } from "@/components/settings/components/setting-row"
import { parseNumericInput } from "@/features/settings/shared"

export interface DocumentRetrievalValues {
  topK: number
  relevanceThreshold: number
  maxContextTokens: number
}

export interface DocumentRetrievalParamsProps {
  values: DocumentRetrievalValues
  onChange: (values: DocumentRetrievalValues) => void
  disabled?: boolean
}

/** 检索效果三件套：命中条数、相关性门槛、注入提示词的 token 上限。 */
export function DocumentRetrievalParams({
  values,
  onChange,
  disabled,
}: DocumentRetrievalParamsProps) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold leading-6 text-foreground">检索效果</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
          决定召回多少片段、门槛多高，以及最多占用多少上下文。
        </p>
      </div>
      <SettingRow
        title="Top K"
        description="返回最相关的片段数（1-20）。"
        htmlFor="rag-top-k"
      >
        <Input
          id="rag-top-k"
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={values.topK}
          onChange={(event) =>
            onChange({ ...values, topK: parseNumericInput(event.target.value, values.topK) })
          }
        />
      </SettingRow>
      <SettingRow
        title="相关性阈值"
        description="低于该分数的片段会被丢弃（0-1）。"
        htmlFor="rag-relevance-threshold"
      >
        <Input
          id="rag-relevance-threshold"
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={values.relevanceThreshold}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value)
            onChange({
              ...values,
              relevanceThreshold: Number.isNaN(parsed) ? values.relevanceThreshold : parsed,
            })
          }}
        />
      </SettingRow>
      <SettingRow
        title="上下文 Token 上限"
        description="注入提示词的检索内容上限（500-32000）。"
        htmlFor="rag-max-context-tokens"
      >
        <Input
          id="rag-max-context-tokens"
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={values.maxContextTokens}
          onChange={(event) =>
            onChange({
              ...values,
              maxContextTokens: parseNumericInput(event.target.value, values.maxContextTokens),
            })
          }
        />
      </SettingRow>
    </div>
  )
}
