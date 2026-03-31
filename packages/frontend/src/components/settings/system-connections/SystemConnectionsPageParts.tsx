"use client"

import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"

export function StatTile({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className?: string
}) {
  return (
    <div className={`rounded-2xl border border-border/70 bg-background/70 px-4 py-3 ${className || ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

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
    <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
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

export function EditorSummary({
  endpoint,
  provider,
  keyCount,
  labels,
}: {
  endpoint: string
  provider: string
  keyCount: number
  labels: string[]
}) {
  return (
    <Card className="border-border/70 bg-background/55 shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle className="text-lg">当前编辑摘要</CardTitle>
        <CardDescription>减少来回滚动，随时确认你正在保存的是哪一组。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="text-xs text-muted-foreground">端点</div>
          <div className="mt-1 break-all font-medium">{endpoint || "尚未填写"}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs text-muted-foreground">Provider</div>
            <div className="mt-1 font-medium">{provider}</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="text-xs text-muted-foreground">Key 数量</div>
            <div className="mt-1 font-medium">{keyCount}</div>
          </div>
        </div>
        <div className="space-y-2 rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="text-xs text-muted-foreground">Key 标签</div>
          <div className="flex flex-wrap gap-2">
            {labels.map((label) => (
              <Badge key={label} variant="outline" className="rounded-full px-3 py-1">
                {label}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
