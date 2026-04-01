"use client"

import { useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { AlertDialog } from "@/components/ui/alert-dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DestructiveConfirmDialogContent } from "@/components/ui/destructive-confirm-dialog"
import { useSystemConnections, SPECIAL_PROVIDER_DEEPSEEK, SPECIAL_VENDOR_DEEPSEEK } from "@/components/settings/system-connections/use-system-connections"
import { CONNECTION_CAP_KEYS, CONNECTION_CAP_LABELS } from "@/components/settings/system-connections/constants"
import { SystemConnectionKeyPool } from "@/components/settings/system-connections/SystemConnectionKeyPool"
import { SystemConnectionVerifyPanel } from "@/components/settings/system-connections/SystemConnectionVerifyPanel"
import { SystemConnectionGroupList } from "@/components/settings/system-connections/SystemConnectionGroupList"
import { Field, HelperText } from "@/components/settings/system-connections/SystemConnectionsPageParts"
import { cn } from "@/lib/utils"

export function SystemConnectionsPage() {
  const {
    connections,
    loading,
    submitting,
    verifying,
    deletingId,
    error,
    form,
    setForm,
    capabilities,
    editing,
    verifyResult,
    refresh,
    startEdit,
    cancelEdit,
    addKey,
    removeKey,
    updateKey,
    submitConnection,
    verifyConnection,
    removeConnection,
    toggleCapability,
  } = useSystemConnections()
  const reducedMotion = useReducedMotion()
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  const handleProviderChange = (value: string) => {
    setForm((prev) => {
      const isGoogle = value === "google_genai"
      const isDeepseek = value === SPECIAL_PROVIDER_DEEPSEEK
      const next = {
        ...prev,
        provider: value,
        authType: isGoogle || isDeepseek ? "bearer" : prev.authType,
      }
      if (isDeepseek && (!prev.baseUrl || prev.provider !== SPECIAL_PROVIDER_DEEPSEEK)) {
        next.baseUrl = "https://api.deepseek.com/v1"
      }
      return next
    })
  }

  const renderVendorLabel = (vendor?: string | null) => {
    if (vendor === SPECIAL_VENDOR_DEEPSEEK) return "DeepSeek（交错思考）"
    return null
  }

  const baseUrlPlaceholder = (() => {
    if (form.provider === SPECIAL_PROVIDER_DEEPSEEK) return "https://api.deepseek.com/v1"
    if (form.provider === "ollama") return "http://localhost:11434"
    if (form.provider === "google_genai") return "https://generativelanguage.googleapis.com/v1beta"
    return "https://api.openai.com/v1"
  })()

  const heroMotion = reducedMotion
    ? {}
    : {
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.28, ease: "easeOut" as const },
      }

  return (
    <div className="space-y-6 min-w-0">
      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <DestructiveConfirmDialogContent
          title="删除整个端点组"
          description="该操作会删除这个 API 端点下的所有 Key 条目，并清空相关模型目录缓存。"
          warning="删除后不会保留回滚入口，请确认当前不是仍在使用的生产端点。"
          actionLabel={deletingId === confirmDeleteId ? "删除中..." : "确认删除"}
          actionDisabled={deletingId === confirmDeleteId}
          onAction={() => {
            if (confirmDeleteId != null) {
              void removeConnection(confirmDeleteId)
            }
            setConfirmDeleteId(null)
          }}
        />
      </AlertDialog>

      <motion.div
        {...heroMotion}
        className="space-y-4"
      >
        {error ? (
          <div
            role="alert"
            className="rounded-2xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        <Card className="border-border/80 bg-card/95 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{editing ? "编辑端点组" : "新建端点组"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="space-y-4">
              <Field label="Provider" htmlFor="provider">
                <Select value={form.provider} onValueChange={handleProviderChange}>
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="openai_responses">OpenAI（Responses）</SelectItem>
                    <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                    <SelectItem value="ollama">Ollama</SelectItem>
                    <SelectItem value="google_genai">Google Generative AI</SelectItem>
                    <SelectItem value={SPECIAL_PROVIDER_DEEPSEEK}>DeepSeek（交错思考）</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="认证方式" htmlFor="authType">
                <Select
                  value={form.authType}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, authType: value }))}
                  disabled={form.provider === "google_genai"}
                >
                  <SelectTrigger id="authType">
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

              <Field label="Connection Type" htmlFor="connectionType">
                <Select
                  value={form.connectionType}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, connectionType: value }))}
                >
                  <SelectTrigger id="connectionType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="external">external</SelectItem>
                    <SelectItem value="local">local</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Prefix ID" htmlFor="prefixId">
                <Input
                  id="prefixId"
                  value={form.prefixId}
                  onChange={(event) => setForm((prev) => ({ ...prev, prefixId: event.target.value }))}
                  placeholder="可选，用于避免模型名冲突"
                />
              </Field>

              <Field label="Base URL" htmlFor="baseUrl">
                <Input
                  id="baseUrl"
                  value={form.baseUrl}
                  onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                  placeholder={baseUrlPlaceholder}
                />
                <HelperText provider={form.provider} specialProviderDeepseek={SPECIAL_PROVIDER_DEEPSEEK} />
              </Field>

              <Field label="共享标签" htmlFor="tags">
                <Input
                  id="tags"
                  value={form.tags}
                  onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
                  placeholder="prod,team-a,newapi"
                />
                <p className="text-xs leading-5 text-muted-foreground">用于筛选、归组和后续识别来源。</p>
              </Field>

              {form.provider === "azure_openai" ? (
                <Field label="API Version" htmlFor="azureApiVersion">
                  <Input
                    id="azureApiVersion"
                    value={form.azureApiVersion}
                    onChange={(event) => setForm((prev) => ({ ...prev, azureApiVersion: event.target.value }))}
                    placeholder="2024-02-15-preview"
                  />
                </Field>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>默认能力</Label>
              <div className="flex flex-wrap gap-2">
                {CONNECTION_CAP_KEYS.map((key) => (
                  <label
                    key={key}
                    className={cn(
                      "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                      capabilities[key]
                        ? "border-primary/35 bg-primary/10 text-foreground"
                        : "border-border/70 bg-background/90 hover:bg-[hsl(var(--surface-hover))]",
                    )}
                  >
                    <Checkbox
                      checked={capabilities[key]}
                      onCheckedChange={(checked) => toggleCapability(key, Boolean(checked))}
                    />
                    <span>{CONNECTION_CAP_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <SystemConnectionKeyPool
          keys={form.keys}
          reducedMotion={Boolean(reducedMotion)}
          onAddKey={addKey}
          onRemoveKey={removeKey}
          onUpdateKey={updateKey}
        />

        <SystemConnectionVerifyPanel verifyResult={verifyResult} reducedMotion={Boolean(reducedMotion)} />

        <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-[hsl(var(--surface))/0.16] p-3 sm:flex-row sm:flex-wrap">
          <Button onClick={submitConnection} disabled={submitting || verifying} className="min-h-11 w-full sm:w-auto">
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editing ? "保存端点组" : "创建端点组"}
          </Button>
          <Button
            onClick={verifyConnection}
            variant="outline"
            disabled={submitting || verifying}
            className="min-h-11 w-full sm:w-auto"
          >
            {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            并发验证全部 Key
          </Button>
          {editing ? (
            <Button onClick={cancelEdit} variant="ghost" className="min-h-11 w-full sm:w-auto">
              取消编辑
            </Button>
          ) : null}
        </div>
      </motion.div>

      <SystemConnectionGroupList
        connections={connections}
        loading={loading}
        reducedMotion={Boolean(reducedMotion)}
        onRefresh={refresh}
        onStartEdit={startEdit}
        onRequestDelete={setConfirmDeleteId}
        renderVendorLabel={renderVendorLabel}
      />
    </div>
  )
}
