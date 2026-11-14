"use client"

import { ArrowRight } from "lucide-react"
import type { ProviderTemplate } from "./provider-templates"

/**
 * 供应商模板卡：icon 瓦片 + label + description + 连接数徽标 +「配置 →」。
 * 协议选择放在配置向导第 2 步，卡片只负责进入配置，保证三张卡等高、入口一致。
 */
export function ProviderTemplateCard({
  template,
  count,
  onConfigure,
}: {
  template: ProviderTemplate
  count: number
  onConfigure: (template: ProviderTemplate) => void
}) {
  const Icon = template.icon
  const badge = count > 0 ? `已有 ${count} 组连接` : "未配置"

  return (
    <button
      type="button"
      data-testid={`provider-template-${template.provider}`}
      aria-label={`配置${template.label}`}
      onClick={() => onConfigure(template)}
      className="v2-panel group flex w-full cursor-pointer flex-col items-start gap-3 p-4 text-left transition-colors hover:border-border hover:bg-surface-hover"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-ink-tertiary transition-colors group-hover:bg-surface-hover">
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{template.label}</span>
            <span className="whitespace-nowrap rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-muted-foreground">
              {badge}
            </span>
          </span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            {template.description}
          </span>
        </span>
      </span>
      <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-ink-tertiary">
        配置
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}
