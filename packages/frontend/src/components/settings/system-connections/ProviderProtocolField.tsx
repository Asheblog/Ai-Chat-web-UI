"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getProviderProtocolHint, getProviderTemplate } from "./provider-templates"
import { Field } from "./SystemConnectionsPageParts"

export type OpenAIProtocolProvider = "openai" | "openai_responses"

/**
 * OpenAI 双协议选择：Chat Completions / Responses。
 * 只负责协议控件与说明，显示名/思考方言等表单联动由调用方处理。
 */
export function ProviderProtocolField({
  value,
  onChange,
}: {
  value: OpenAIProtocolProvider
  onChange: (provider: OpenAIProtocolProvider) => void
}) {
  const template = getProviderTemplate("openai")
  const protocols = template?.protocols ?? []
  const hint = template ? getProviderProtocolHint(template, value) : undefined

  return (
    <Field label="接口协议" htmlFor="connection-provider-protocol">
      <Select value={value} onValueChange={(next) => onChange(next as OpenAIProtocolProvider)}>
        <SelectTrigger id="connection-provider-protocol" aria-label="接口协议">
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
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </Field>
  )
}
