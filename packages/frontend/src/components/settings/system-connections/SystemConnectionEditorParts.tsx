"use client"

import type { Dispatch, ReactNode, SetStateAction } from "react"
import { ChevronDown } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  CONNECTION_CAP_KEYS,
  CONNECTION_CAP_LABELS,
  type ConnectionCapKey,
} from "./constants"
import { Field } from "./SystemConnectionsPageParts"
import type { ConnectionFormState } from "./use-system-connections"

export function AdvancedFields({
  form,
  setForm,
  capabilities,
  onToggleCapability,
  authNeedsConfiguration = false,
  systemOAuthConfigured = false,
}: {
  form: ConnectionFormState
  setForm: Dispatch<SetStateAction<ConnectionFormState>>
  capabilities: Record<ConnectionCapKey, boolean>
  onToggleCapability: (key: ConnectionCapKey, value: boolean) => void
  authNeedsConfiguration?: boolean
  systemOAuthConfigured?: boolean
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Field label="认证方式" htmlFor="connection-auth-type">
        <Select
          value={form.authType}
          onValueChange={(value) =>
            setForm((prev) => ({ ...prev, authType: value as ConnectionFormState["authType"] }))
          }
          disabled={form.provider === "google_genai"}
        >
          <SelectTrigger id="connection-auth-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None（不发送鉴权头）</SelectItem>
            <SelectItem value="bearer">Bearer / API Key</SelectItem>
            <SelectItem value="system_oauth">System OAuth</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs leading-5 text-muted-foreground">
          {form.authType === "system_oauth"
            ? "使用服务器环境变量 SYSTEM_OAUTH_TOKEN 的全局令牌：连接本身不保存凭据，该变量" +
              (systemOAuthConfigured ? "已配置。" : "未配置（请求将不带鉴权头）。") +
              "切换认证方式前请确认网关接受 Bearer。"
            : form.authType === "none"
              ? "请求不携带任何鉴权头，仅用于本地或已由网关鉴权的端点。"
              : "API Key 保存在 Secret Vault，请求时解密为 Authorization / x-api-key 头。"}
        </p>
        {authNeedsConfiguration ? (
          <p className="text-xs leading-5 text-warning">
            此连接仍保存着已移除的 Session 认证（从未有鉴权头实现）。请重新选择认证方式并填写 API Key，在此之前该连接的请求会被拒绝。
          </p>
        ) : null}
      </Field>

      <Field label="Prefix ID（参与模型身份）" htmlFor="connection-prefix">
        <Input
          id="connection-prefix"
          value={form.prefixId}
          onChange={(event) => setForm((prev) => ({ ...prev, prefixId: event.target.value }))}
          placeholder="openai-prod"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          模型对外 ID 为「前缀.模型 ID」，同时用于存量会话的模型解析；修改后旧会话的模型身份可能失效。通常留空，同名模型请改用连接显示名区分。
        </p>
      </Field>

      <Field label="标签（仅用于分类）" htmlFor="connection-tags-advanced">
        <Input
          id="connection-tags-advanced"
          value={form.tags}
          onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
          placeholder="prod,team-a"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          标签只用于列表归类与搜索，不再决定模型能力；能力只看下方默认能力与供应商声明。
        </p>
      </Field>

      <Field label="自定义 Headers（JSON）" htmlFor="connection-headers" className="lg:col-span-2">
        <Textarea
          id="connection-headers"
          value={form.headers}
          onChange={(event) => setForm((prev) => ({ ...prev, headers: event.target.value }))}
          placeholder='{"X-Custom":"value"}'
          className="min-h-[88px] font-mono text-xs"
        />
      </Field>

      <div className="space-y-2 lg:col-span-2">
        <Label>默认能力（连接级）</Label>
        <p className="text-xs leading-5 text-muted-foreground">
          能力的唯一入口：这里设置连接默认值，供应商声明的能力优先于它，模型页的人工覆写最高；标签不参与判定。
        </p>
        <div className="flex flex-wrap gap-2">
          {CONNECTION_CAP_KEYS.map((key) => (
            <label
              key={key}
              className={cn(
                "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                capabilities[key]
                  ? "border-border bg-surface-subtle text-foreground"
                  : "border-border bg-surface hover:bg-[hsl(var(--surface-hover))]",
              )}
            >
              <Checkbox checked={capabilities[key]} onCheckedChange={(checked) => onToggleCapability(key, Boolean(checked))} />
              <span>{CONNECTION_CAP_LABELS[key]}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CollapsibleEditorSection({
  icon,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  icon: ReactNode
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-subtle text-ink-tertiary">{icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="border-t border-border p-4">{children}</div> : null}
    </section>
  )
}
