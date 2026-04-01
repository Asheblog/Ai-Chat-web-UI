"use client"

import type { ReactNode } from "react"
import { Label } from "@/components/ui/label"

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

export function HelperText({ provider, specialProviderDeepseek }: { provider: string; specialProviderDeepseek: string }) {
  if (provider === "openai" || provider === "openai_responses") {
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
  if (provider === specialProviderDeepseek) {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        DeepSeek 推理模式建议直接指向官方 OpenAI 兼容入口。
      </p>
    )
  }
  return null
}
