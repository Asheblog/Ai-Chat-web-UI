"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { ArrowLeft, ArrowRight, KeyRound, Loader2, Settings2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import type { SystemConnectionGroup, VerifyConnectionResult } from "@/services/system-connections"
import {
  SPECIAL_PROVIDER_OPENAI_INTERLEAVE,
  type ConnectionCapKey,
} from "./constants"
import { validateBasicFields, type ConnectionFormState, type ConnectionKeyFormState } from "./form-state"
import { PROVIDER_TEMPLATES, type ProviderTemplate } from "./provider-templates"
import { AdvancedFields, CollapsibleEditorSection } from "./SystemConnectionEditorParts"
import { Field, HelperText } from "./SystemConnectionsPageParts"
import { SystemConnectionKeyPool } from "./SystemConnectionKeyPool"
import { SystemConnectionVerifyPanel } from "./SystemConnectionVerifyPanel"
import { baseUrlPlaceholder, type WizardMode, type WizardStep } from "./view-model"

type SystemConnectionEditorProps = {
  mode: WizardMode
  step: WizardStep
  onStepChange: (step: WizardStep) => void
  form: ConnectionFormState
  setForm: Dispatch<SetStateAction<ConnectionFormState>>
  firstKey: ConnectionKeyFormState | undefined
  capabilities: Record<ConnectionCapKey, boolean>
  editing: SystemConnectionGroup | null
  submitting: boolean
  verifying: boolean
  verifyResult: VerifyConnectionResult | null
  onSelectTemplate: (template: ProviderTemplate) => void
  onToggleCapability: (key: ConnectionCapKey, value: boolean) => void
  onAddKey: () => void
  onRemoveKey: (clientId: string) => void
  onUpdateKey: (
    clientId: string,
    updater: (current: ConnectionKeyFormState) => ConnectionKeyFormState,
  ) => void
  onSubmit: () => Promise<boolean>
  onVerify: () => Promise<boolean>
  onCancel: () => void
}

export function SystemConnectionEditor({
  mode,
  step,
  onStepChange,
  form,
  setForm,
  firstKey,
  capabilities,
  editing,
  submitting,
  verifying,
  verifyResult,
  onSelectTemplate,
  onToggleCapability,
  onAddKey,
  onRemoveKey,
  onUpdateKey,
  onSubmit,
  onVerify,
  onCancel,
}: SystemConnectionEditorProps) {
  const { toast } = useToast()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)

  useEffect(() => {
    setAdvancedOpen(false)
    setKeysOpen(false)
  }, [mode, editing?.id, step])

  const goNextFromBasic = () => {
    const error = validateBasicFields(form)
    if (error) {
      toast({
        title: "表单未完成",
        description: error,
        variant: "destructive",
      })
      return
    }
    onStepChange(3)
  }

  const keySummary =
    firstKey?.hasStoredApiKey || firstKey?.apiKeyMasked
      ? firstKey.apiKeyMasked || "已保存"
      : firstKey?.apiKey
        ? "已填写（未保存）"
        : form.authType === "none"
          ? "无需密钥"
          : "未配置"

  return (
    <div className="space-y-4">
      {mode === "create" ? <WizardStepIndicator step={step} /> : null}

      {mode === "create" && step === 1 ? (
        <ProviderStep onSelect={onSelectTemplate} />
      ) : null}

      {(mode === "edit" || (mode === "create" && step === 2)) ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              {mode === "edit" ? "编辑连接" : "第 2 步 · 基础信息"}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              显示名称用于列表与模型选择；高级项默认折叠。
            </p>
          </div>

          <div className="grid gap-4 rounded-md border border-border bg-card p-4">
            <Field label="显示名称" htmlFor="connection-display-name">
              <Input
                id="connection-display-name"
                value={form.displayName}
                onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))}
                placeholder="例如：办公 OpenAI"
                required
              />
            </Field>

            <Field label="API 端点" htmlFor="connection-base-url">
              <Input
                id="connection-base-url"
                type="url"
                value={form.baseUrl}
                onChange={(event) => setForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                placeholder={baseUrlPlaceholder(form.provider)}
              />
              <HelperText provider={form.provider} specialProviderOpenaiInterleave={SPECIAL_PROVIDER_OPENAI_INTERLEAVE} />
            </Field>

            <Field label="API Key" htmlFor="connection-api-key">
              <Input
                id="connection-api-key"
                type="password"
                value={firstKey?.apiKey ?? ""}
                onChange={(event) => {
                  if (!firstKey) return
                  onUpdateKey(firstKey.clientId, (current) => ({ ...current, apiKey: event.target.value }))
                }}
                placeholder={firstKey?.hasStoredApiKey ? "留空则继续使用已保存的 Key" : "sk-..."}
                disabled={form.authType === "none"}
              />
              {firstKey?.apiKeyMasked ? (
                <p className="text-xs text-muted-foreground">当前摘要：{firstKey.apiKeyMasked}</p>
              ) : null}
            </Field>

            {mode === "edit" ? (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Key 摘要：{keySummary} · 共 {form.keys.length} 个条目
              </div>
            ) : null}
          </div>

          <AdvancedSections
            form={form}
            setForm={setForm}
            capabilities={capabilities}
            onToggleCapability={onToggleCapability}
            onAddKey={onAddKey}
            onRemoveKey={onRemoveKey}
            onUpdateKey={onUpdateKey}
            advancedOpen={advancedOpen}
            keysOpen={keysOpen}
            onToggleAdvanced={() => setAdvancedOpen((prev) => !prev)}
            onToggleKeys={() => setKeysOpen((prev) => !prev)}
          />

          <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={mode === "create" ? () => onStepChange(1) : onCancel}>
              {mode === "create" ? (
                <>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  上一步
                </>
              ) : (
                "取消"
              )}
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              {mode === "edit" ? (
                <>
                  <Button variant="outline" onClick={() => void onVerify()} disabled={submitting || verifying}>
                    {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                    {verifying ? "验证中..." : "验证连接"}
                  </Button>
                  <Button onClick={() => void onSubmit()} disabled={submitting || verifying}>
                    {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    保存连接
                  </Button>
                </>
              ) : (
                <Button onClick={goNextFromBasic}>
                  下一步
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {mode === "edit" && verifyResult ? (
            <CollapsibleEditorSection
              icon={<ShieldCheck className="h-4 w-4" />}
              title="验证结果"
              summary={`成功 ${verifyResult.successCount}，失败 ${verifyResult.failureCount}`}
              open
              onToggle={() => undefined}
            >
              <SystemConnectionVerifyPanel verifyResult={verifyResult} />
            </CollapsibleEditorSection>
          ) : null}
        </>
      ) : null}

      {mode === "create" && step === 3 ? (
        <>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">第 3 步 · 验证并保存</p>
            <p className="text-xs leading-5 text-muted-foreground">
              {form.displayName} · {form.baseUrl}
            </p>
          </div>

          <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            建议先验证连通性，再创建连接。高级配置仍可在保存前展开调整。
          </div>

          <AdvancedSections
            form={form}
            setForm={setForm}
            capabilities={capabilities}
            onToggleCapability={onToggleCapability}
            onAddKey={onAddKey}
            onRemoveKey={onRemoveKey}
            onUpdateKey={onUpdateKey}
            advancedOpen={advancedOpen}
            keysOpen={keysOpen}
            onToggleAdvanced={() => setAdvancedOpen((prev) => !prev)}
            onToggleKeys={() => setKeysOpen((prev) => !prev)}
          />

          <CollapsibleEditorSection
            icon={<ShieldCheck className="h-4 w-4" />}
            title="验证结果"
            summary={
              verifyResult
                ? `成功 ${verifyResult.successCount}，失败 ${verifyResult.failureCount}`
                : "验证后在这里查看模型和错误详情"
            }
            open={Boolean(verifyResult)}
            onToggle={() => undefined}
          >
            <SystemConnectionVerifyPanel verifyResult={verifyResult} />
          </CollapsibleEditorSection>

          <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-between">
            <Button variant="ghost" onClick={() => onStepChange(2)}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              上一步
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => void onVerify()} disabled={submitting || verifying}>
                {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                {verifying ? "验证中..." : "验证连接"}
              </Button>
              <Button onClick={() => void onSubmit()} disabled={submitting || verifying}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                创建连接
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function WizardStepIndicator({ step }: { step: WizardStep }) {
  const items = [
    { id: 1 as const, label: "选供应商" },
    { id: 2 as const, label: "基础信息" },
    { id: 3 as const, label: "验证保存" },
  ]
  return (
    <ol className="flex flex-wrap gap-2" aria-label="创建向导步骤">
      {items.map((item) => (
        <li
          key={item.id}
          className={
            item.id === step
              ? "rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              : item.id < step
                ? "rounded-md bg-muted px-2.5 py-1 text-xs text-foreground"
                : "rounded-md bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground"
          }
        >
          {item.id}. {item.label}
        </li>
      ))}
    </ol>
  )
}

function ProviderStep({ onSelect }: { onSelect: (template: ProviderTemplate) => void }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">第 1 步 · 选择供应商</p>
        <p className="text-xs leading-5 text-muted-foreground">选择模板后将预填默认端点与认证方式。</p>
      </div>
      <div className="grid gap-2">
        {PROVIDER_TEMPLATES.map((template) => {
          const Icon = template.icon
          return (
            <button
              key={template.provider}
              type="button"
              onClick={() => onSelect(template)}
              className="flex w-full cursor-pointer items-start gap-3 rounded-md border border-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{template.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{template.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AdvancedSections({
  form,
  setForm,
  capabilities,
  onToggleCapability,
  onAddKey,
  onRemoveKey,
  onUpdateKey,
  advancedOpen,
  keysOpen,
  onToggleAdvanced,
  onToggleKeys,
}: {
  form: ConnectionFormState
  setForm: Dispatch<SetStateAction<ConnectionFormState>>
  capabilities: Record<ConnectionCapKey, boolean>
  onToggleCapability: (key: ConnectionCapKey, value: boolean) => void
  onAddKey: () => void
  onRemoveKey: (clientId: string) => void
  onUpdateKey: (
    clientId: string,
    updater: (current: ConnectionKeyFormState) => ConnectionKeyFormState,
  ) => void
  advancedOpen: boolean
  keysOpen: boolean
  onToggleAdvanced: () => void
  onToggleKeys: () => void
}) {
  return (
    <>
      <CollapsibleEditorSection
        icon={<Settings2 className="h-4 w-4" />}
        title="高级设置"
        summary="Prefix、Headers、连接类型、默认能力与标签"
        open={advancedOpen}
        onToggle={onToggleAdvanced}
      >
        <AdvancedFields
          form={form}
          setForm={setForm}
          capabilities={capabilities}
          onToggleCapability={onToggleCapability}
        />
      </CollapsibleEditorSection>

      <CollapsibleEditorSection
        icon={<KeyRound className="h-4 w-4" />}
        title="Key 池"
        summary={`${form.keys.length} 个 Key，可配置模型白名单`}
        open={keysOpen}
        onToggle={onToggleKeys}
      >
        <SystemConnectionKeyPool
          keys={form.keys}
          onAddKey={onAddKey}
          onRemoveKey={onRemoveKey}
          onUpdateKey={onUpdateKey}
        />
      </CollapsibleEditorSection>
    </>
  )
}
