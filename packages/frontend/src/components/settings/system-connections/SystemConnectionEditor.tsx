"use client"

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react"
import { KeyRound, Loader2, Settings2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { deriveChannelName } from "@/lib/utils"
import type { SystemConnectionGroup, VerifyConnectionResult } from "@/services/system-connections"
import {
  SPECIAL_PROVIDER_OPENAI_INTERLEAVE,
  type ConnectionCapKey,
} from "./constants"
import { AdvancedFields, CollapsibleEditorSection } from "./SystemConnectionEditorParts"
import { Field, HelperText } from "./SystemConnectionsPageParts"
import { SystemConnectionKeyPool } from "./SystemConnectionKeyPool"
import { SystemConnectionVerifyPanel } from "./SystemConnectionVerifyPanel"
import type { ConnectionFormState, ConnectionKeyFormState } from "./use-system-connections"
import { baseUrlPlaceholder, getModelCount, type DetailIntent, type EditorFocus } from "./view-model"

type OpenSections = Record<Exclude<EditorFocus, "basic">, boolean>

type SystemConnectionEditorProps = {
  group: SystemConnectionGroup | null
  detailIntent: DetailIntent
  initialFocus: EditorFocus
  form: ConnectionFormState
  setForm: Dispatch<SetStateAction<ConnectionFormState>>
  firstKey: ConnectionKeyFormState | undefined
  capabilities: Record<ConnectionCapKey, boolean>
  editing: SystemConnectionGroup | null
  submitting: boolean
  verifying: boolean
  verifyResult: VerifyConnectionResult | null
  reducedMotion: boolean
  onProviderChange: (value: string) => void
  onToggleCapability: (key: ConnectionCapKey, value: boolean) => void
  onAddKey: () => void
  onRemoveKey: (clientId: string) => void
  onUpdateKey: (
    clientId: string,
    updater: (current: ConnectionKeyFormState) => ConnectionKeyFormState,
  ) => void
  onSubmit: () => Promise<boolean>
  onVerify: () => Promise<boolean>
  onCancelCreate: () => void
}

export function SystemConnectionEditor({
  group,
  detailIntent,
  initialFocus,
  form,
  setForm,
  firstKey,
  capabilities,
  editing,
  submitting,
  verifying,
  verifyResult,
  reducedMotion,
  onProviderChange,
  onToggleCapability,
  onAddKey,
  onRemoveKey,
  onUpdateKey,
  onSubmit,
  onVerify,
  onCancelCreate,
}: SystemConnectionEditorProps) {
  const [openSections, setOpenSections] = useState<OpenSections>({
    advanced: initialFocus === "advanced",
    keys: initialFocus === "keys",
    verify: initialFocus === "verify",
  })

  useEffect(() => {
    setOpenSections({
      advanced: initialFocus === "advanced",
      keys: initialFocus === "keys",
      verify: initialFocus === "verify",
    })
  }, [group?.id, detailIntent, initialFocus])

  useEffect(() => {
    if (verifyResult) {
      setOpenSections((prev) => ({ ...prev, verify: true }))
    }
  }, [verifyResult])

  const modelIds = useMemo(() => {
    if (group) return Array.from(new Set(group.apiKeys.flatMap((key) => key.modelIds))).slice(0, 5)
    return firstKey?.modelIds.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 5) ?? []
  }, [firstKey?.modelIds, group])

  const toggleSection = (key: keyof OpenSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-[8px] border border-accent bg-card px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {detailIntent === "create" ? "新增连接" : group ? deriveChannelName(group.provider, group.baseUrl) : "连接配置"}
            </span>
            <span className="v2-status">{detailIntent === "create" ? "新建模式" : "展开编辑"}</span>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            基础信息保持可见，高级参数、Key 池和验证结果默认折叠，按需展开处理。
          </p>
        </div>
        {detailIntent === "create" ? (
          <Button variant="ghost" size="sm" onClick={onCancelCreate} className="self-start">
            取消新增
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 rounded-[8px] border border-border bg-card p-4 lg:grid-cols-2">
        <Field label="Provider" htmlFor="connection-provider">
          <Select value={form.provider} onValueChange={onProviderChange}>
            <SelectTrigger id="connection-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="openai_responses">OpenAI（Responses）</SelectItem>
              <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
              <SelectItem value="ollama">Ollama</SelectItem>
              <SelectItem value="google_genai">Google Generative AI</SelectItem>
              <SelectItem value={SPECIAL_PROVIDER_OPENAI_INTERLEAVE}>OpenAI（交错思考兼容）</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="名称 / Prefix ID" htmlFor="connection-prefix">
          <Input
            id="connection-prefix"
            value={form.prefixId}
            onChange={(event) => setForm((prev) => ({ ...prev, prefixId: event.target.value }))}
            placeholder="OpenAI-主力"
          />
        </Field>

        <Field label="API 端点" htmlFor="connection-base-url" className="lg:col-span-2">
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
          />
          {firstKey?.apiKeyMasked ? <p className="text-xs text-muted-foreground">当前摘要：{firstKey.apiKeyMasked}</p> : null}
        </Field>

        <Field label="标签 / 备注" htmlFor="connection-tags">
          <Textarea
            id="connection-tags"
            value={form.tags}
            onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
            placeholder="prod,team-a,main"
            className="min-h-[78px]"
          />
        </Field>

        <div className="lg:col-span-2">
          <Label>模型摘要</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {modelIds.length > 0 ? (
              <>
                {modelIds.map((modelId) => (
                  <span key={modelId} className="rounded-[8px] bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    {modelId}
                  </span>
                ))}
                {group && getModelCount(group) > modelIds.length ? (
                  <span className="rounded-[8px] bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    +{getModelCount(group) - modelIds.length}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-sm text-muted-foreground">自动枚举或未配置显式模型</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-[8px] border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">保存前可以先验证连接；验证结果会自动展开到下方区域。</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button onClick={() => void onVerify()} variant="outline" disabled={submitting || verifying} className="justify-center">
            {verifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            {verifying ? "验证中..." : "验证连接"}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={submitting || verifying} className="justify-center">
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {editing ? "保存连接" : "创建连接"}
          </Button>
        </div>
      </div>

      <CollapsibleEditorSection
        icon={<Settings2 className="h-4 w-4" />}
        title="高级设置"
        summary="认证方式、连接类型、Azure 版本和默认能力"
        open={openSections.advanced}
        onToggle={() => toggleSection("advanced")}
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
        summary={`${form.keys.length} 个 Key，展开后编辑密钥、状态和模型白名单`}
        open={openSections.keys}
        onToggle={() => toggleSection("keys")}
      >
        <SystemConnectionKeyPool
          keys={form.keys}
          reducedMotion={reducedMotion}
          onAddKey={onAddKey}
          onRemoveKey={onRemoveKey}
          onUpdateKey={onUpdateKey}
        />
      </CollapsibleEditorSection>

      <CollapsibleEditorSection
        icon={<ShieldCheck className="h-4 w-4" />}
        title="验证结果"
        summary={verifyResult ? `成功 ${verifyResult.successCount}，失败 ${verifyResult.failureCount}` : "验证后在这里查看模型和错误详情"}
        open={openSections.verify}
        onToggle={() => toggleSection("verify")}
      >
        <SystemConnectionVerifyPanel verifyResult={verifyResult} reducedMotion={reducedMotion} />
      </CollapsibleEditorSection>
    </div>
  )
}
