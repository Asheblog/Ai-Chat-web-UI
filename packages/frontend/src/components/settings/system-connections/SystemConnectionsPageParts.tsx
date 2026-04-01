"use client"

import type { ReactNode } from "react"
import { Network, Sparkles } from "lucide-react"
import { CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export function SystemConnectionsHero({
  connectionCount,
  totalConfiguredKeys,
  enabledConfiguredKeys,
}: {
  connectionCount: number
  totalConfiguredKeys: number
  enabledConfiguredKeys: number
}) {
  return (
    <div className="border-b border-border/70 px-6 py-6 sm:px-8">
      <div className="space-y-5">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            连接管理
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.45] p-3 text-primary">
                <Network className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight">把共享端点和独立 Key 放在同一个工作台里维护</h2>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  按顺序填写共享连接参数、Key 池和验证结果，优先保证可读性，不再强行把主要内容并排塞进同一行。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.36] px-3 py-1.5">共享 Base URL / 认证方式</span>
              <span className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.36] px-3 py-1.5">每个 Key 独立标签与模型范围</span>
              <span className="rounded-full border border-border/70 bg-[hsl(var(--surface))/0.36] px-3 py-1.5">验证结果按 Key 展开查看</span>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="端点组" value={connectionCount} />
          <StatTile label="已配置 Key" value={totalConfiguredKeys} />
          <StatTile label="启用中" value={enabledConfiguredKeys} />
        </div>
      </div>
    </div>
  )
}

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
    <div className={cn("min-w-[120px] rounded-2xl border border-border/80 bg-card/90 px-4 py-3", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
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
