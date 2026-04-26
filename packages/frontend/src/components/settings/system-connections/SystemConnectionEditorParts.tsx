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
}: {
  form: ConnectionFormState
  setForm: Dispatch<SetStateAction<ConnectionFormState>>
  capabilities: Record<ConnectionCapKey, boolean>
  onToggleCapability: (key: ConnectionCapKey, value: boolean) => void
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Field label="认证方式" htmlFor="connection-auth-type">
        <Select
          value={form.authType}
          onValueChange={(value) => setForm((prev) => ({ ...prev, authType: value }))}
          disabled={form.provider === "google_genai"}
        >
          <SelectTrigger id="connection-auth-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="bearer">Bearer</SelectItem>
            <SelectItem value="session">Session</SelectItem>
            <SelectItem value="system_oauth">System OAuth</SelectItem>
            <SelectItem value="microsoft_entra_id">Entra ID</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="连接类型" htmlFor="connection-type">
        <Select
          value={form.connectionType}
          onValueChange={(value) => setForm((prev) => ({ ...prev, connectionType: value }))}
        >
          <SelectTrigger id="connection-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="external">external</SelectItem>
            <SelectItem value="local">local</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {form.provider === "azure_openai" ? (
        <Field label="API Version" htmlFor="connection-azure-version" className="lg:col-span-2">
          <Input
            id="connection-azure-version"
            value={form.azureApiVersion}
            onChange={(event) => setForm((prev) => ({ ...prev, azureApiVersion: event.target.value }))}
            placeholder="2024-02-15-preview"
          />
        </Field>
      ) : null}

      <div className="space-y-2 lg:col-span-2">
        <Label>默认能力</Label>
        <div className="flex flex-wrap gap-2">
          {CONNECTION_CAP_KEYS.map((key) => (
            <label
              key={key}
              className={cn(
                "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[8px] border px-3 py-1.5 text-sm transition-colors",
                capabilities[key]
                  ? "border-primary/35 bg-primary/10 text-foreground"
                  : "border-border/70 bg-background/90 hover:bg-[hsl(var(--surface-hover))]",
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
    <section className="overflow-hidden rounded-[8px] border border-slate-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-blue-50/55"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-blue-50 text-primary">{icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-950">{title}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-500">{summary}</span>
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-500 transition-transform", open && "rotate-180")} />
      </button>
      {open ? <div className="border-t border-slate-200 p-4">{children}</div> : null}
    </section>
  )
}

