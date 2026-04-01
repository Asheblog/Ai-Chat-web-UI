"use client"

import type { ReactNode } from "react"
import { Network, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

export function EditorSummary({
  modeLabel,
  endpoint,
  provider,
  authType,
  connectionType,
  keyCount,
  enabledKeyCount,
  labels,
  tags,
}: {
  modeLabel: string
  endpoint: string
  provider: string
  authType: string
  connectionType: string
  keyCount: number
  enabledKeyCount: number
  labels: string[]
  tags: string[]
}) {
  return (
    <Card className="border-border/80 bg-card/95 shadow-none">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">当前草稿</CardTitle>
            <CardDescription>保存前快速确认当前端点、认证方式和 Key 分布。</CardDescription>
          </div>
          <Badge variant="outline" className="rounded-full px-3 py-1 text-xs">
            {modeLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] p-4">
          <div className="text-xs text-muted-foreground">端点</div>
          <div className="mt-2 break-all font-medium text-foreground">{endpoint || "尚未填写"}</div>
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] p-4">
            <div className="text-xs text-muted-foreground">Provider</div>
            <div className="mt-1.5 font-medium">{provider}</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] p-4">
            <div className="text-xs text-muted-foreground">认证方式</div>
            <div className="mt-1.5 font-medium">{authType}</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] p-4">
            <div className="text-xs text-muted-foreground">连接类型</div>
            <div className="mt-1.5 font-medium">{connectionType}</div>
          </div>
          <div className="rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] p-4">
            <div className="text-xs text-muted-foreground">Key 数量</div>
            <div className="mt-1.5 font-medium">{enabledKeyCount}/{keyCount} 已启用</div>
          </div>
        </div>
        <div className="space-y-2 rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] p-4">
          <div className="text-xs text-muted-foreground">共享标签</div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag, index) => (
                <Badge key={`${tag}-${index}`} variant="outline" className="rounded-full px-3 py-1">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">未设置共享标签</div>
          )}
        </div>
        <div className="space-y-2 rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.38] p-4">
          <div className="text-xs text-muted-foreground">Key 标签</div>
          <div className="flex flex-wrap gap-2">
            {labels.map((label, index) => (
              <Badge key={`${label}-${index}`} variant="outline" className="rounded-full px-3 py-1">
                {label}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
