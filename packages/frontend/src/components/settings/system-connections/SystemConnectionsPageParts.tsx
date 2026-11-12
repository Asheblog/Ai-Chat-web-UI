"use client"

import type { ReactNode } from "react"
import { Label } from "@/components/ui/label"
import { ANTHROPIC_API_VERSION, ANTHROPIC_BASE_URL } from "./provider-templates"

export function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string
  htmlFor: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className ? `space-y-2.5 ${className}` : "space-y-2.5"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

export function HelperText({ provider }: { provider: string }) {
  if (provider === "openai") {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        允许完整 Base URL。示例：OpenAI 使用 <span className="font-mono">https://api.openai.com/v1</span>，
        NewAPI 之类的兼容网关也建议填写到版本层。DeepSeek / SiliconFlow 等支持 Thinking 的端点可在下方开启兼容模式。
      </p>
    )
  }
  if (provider === "openai_responses") {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        允许完整 Base URL。示例：OpenAI 使用 <span className="font-mono">https://api.openai.com/v1</span>，
        NewAPI 之类的兼容网关也建议填写到版本层。
      </p>
    )
  }
  if (provider === "google_genai") {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        默认基地址为 <span className="font-mono">https://generativelanguage.googleapis.com/v1beta</span>。
      </p>
    )
  }
  if (provider === "anthropic") {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        允许完整 Base URL。官方端点：<span className="font-mono">{ANTHROPIC_BASE_URL}</span>；
        兼容网关也建议填写到版本层。请求会自动携带{" "}
        <span className="font-mono">x-api-key</span> 与{" "}
        <span className="font-mono">anthropic-version: {ANTHROPIC_API_VERSION}</span>，可在自定义 Headers 中覆盖版本或追加 beta 头。
      </p>
    )
  }
  return null
}