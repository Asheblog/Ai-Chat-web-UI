"use client"

import { useState } from "react"
import { ArrowRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getProviderProtocolHint, type ProviderTemplate, type ProviderTemplateKey } from "./provider-templates"

/**
 * 供应商模板卡：icon 瓦片 + label + description + 连接数徽标 +「配置 →」。
 * OpenAI 卡额外提供协议选择（Chat Completions / Responses）；
 * 其他卡整卡可点击，OpenAI 卡用独立「配置」按钮避免交互元素嵌套。
 */
export function ProviderTemplateCard({
  template,
  count,
  onConfigure,
}: {
  template: ProviderTemplate
  count: number
  onConfigure: (template: ProviderTemplate, provider: ProviderTemplateKey) => void
}) {
  const Icon = template.icon
  const protocols = template.protocols ?? []
  const [selectedProvider, setSelectedProvider] = useState<ProviderTemplateKey>(template.provider)
  const badge = count > 0 ? `已有 ${count} 组连接` : "未配置"
  const protocolHint = getProviderProtocolHint(template, selectedProvider)

  if (protocols.length > 0) {
    return (
      <div
        data-testid={`provider-template-${template.provider}`}
        className="v2-panel group flex w-full flex-col items-start gap-3 p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{template.label}</span>
              <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {badge}
              </span>
            </span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              {template.description}
            </span>
          </span>
        </div>

        <div className="w-full space-y-1.5">
          <Label
            htmlFor={`provider-protocol-${template.provider}`}
            className="text-xs font-medium text-muted-foreground"
          >
            接口协议
          </Label>
          <Select
            value={selectedProvider}
            onValueChange={(value) => setSelectedProvider(value as ProviderTemplateKey)}
          >
            <SelectTrigger
              id={`provider-protocol-${template.provider}`}
              aria-label={`${template.label} 接口协议`}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {protocols.map((protocol) => (
                <SelectItem key={protocol.provider} value={protocol.provider}>
                  {protocol.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {protocolHint ? (
            <p className="text-xs leading-5 text-muted-foreground">{protocolHint}</p>
          ) : null}
        </div>

        <button
          type="button"
          aria-label={`配置${template.label}`}
          onClick={() => onConfigure(template, selectedProvider)}
          className="mt-auto inline-flex cursor-pointer items-center gap-1 rounded-sm text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          配置
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      data-testid={`provider-template-${template.provider}`}
      aria-label={`配置${template.label}`}
      onClick={() => onConfigure(template, template.provider)}
      className="v2-panel group flex w-full cursor-pointer flex-col items-start gap-3 p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{template.label}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {badge}
          </span>
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
          {template.description}
        </span>
      </span>
      <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-primary">
        配置
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}
