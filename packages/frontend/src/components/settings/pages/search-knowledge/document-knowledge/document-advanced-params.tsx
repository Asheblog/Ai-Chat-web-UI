"use client"

import { Input } from "@/components/ui/input"
import { SettingRow } from "@/components/settings/components/setting-row"
import { parseNumericInput } from "@/features/settings/shared"

export interface DocumentAdvancedValues {
  embeddingBatchSize: number
  embeddingConcurrency: number
  chunkSize: number
  chunkOverlap: number
  maxFileSizeMb: number
  maxPages: number
  retentionDays: number
}

export interface DocumentAdvancedParamsProps {
  values: DocumentAdvancedValues
  onChange: (values: DocumentAdvancedValues) => void
}

type NumericKey = keyof DocumentAdvancedValues

const GROUPS: Array<{
  title: string
  hint: string
  fields: Array<{ key: NumericKey; label: string; hint: string }>
}> = [
  {
    title: "Embedding 性能",
    hint: "批量与并发越大越快，也越容易触发供应商限流。",
    fields: [
      { key: "embeddingBatchSize", label: "批量大小", hint: "单次请求包含的 chunk 数（1-128）。" },
      { key: "embeddingConcurrency", label: "并发数", hint: "批量请求的并发执行数（1-16）。" },
    ],
  },
  {
    title: "文档分块与限制",
    hint: "分块影响检索粒度；文件大小与页数是处理资源边界。",
    fields: [
      { key: "chunkSize", label: "分块大小", hint: "每个片段的字符数（100-8000）。" },
      { key: "chunkOverlap", label: "分块重叠", hint: "相邻片段重叠字符数（0-1000）。" },
      {
        key: "maxFileSizeMb",
        label: "最大文件大小 (MB)",
        hint: "文档解析与知识库上传共用这一个上限（1-200）。",
      },
      { key: "maxPages", label: "最大页数", hint: "PDF 超出部分会被截断（10-1000）。" },
    ],
  },
  {
    title: "存储",
    hint: "文档保留由清理任务执行，单位是天。",
    fields: [{ key: "retentionDays", label: "文档保留天数", hint: "超过此天数的未使用文档会被清理（1-365）。" }],
  },
]

/** 文档解析高级参数：默认折叠，属于资源与成本调优。 */
export function DocumentAdvancedParams({ values, onChange }: DocumentAdvancedParamsProps) {
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group.title} className="space-y-3">
          <div>
            <p className="text-sm font-semibold leading-6 text-foreground">{group.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">{group.hint}</p>
          </div>
          {group.fields.map((field) => (
            <SettingRow
              key={field.key}
              title={field.label}
              description={field.hint}
              htmlFor={`rag-${field.key}`}
            >
              <Input
                id={`rag-${field.key}`}
                type="text"
                inputMode="numeric"
                value={values[field.key]}
                onChange={(event) =>
                  onChange({
                    ...values,
                    [field.key]: parseNumericInput(event.target.value, values[field.key]),
                  })
                }
              />
            </SettingRow>
          ))}
        </div>
      ))}
    </div>
  )
}
