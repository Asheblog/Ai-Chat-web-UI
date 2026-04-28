import type {
  SystemConnectionGroup,
  SystemConnectionPayload,
} from "@/services/system-connections"
import {
  SPECIAL_PROVIDER_OPENAI_INTERLEAVE,
  SPECIAL_VENDOR_OPENAI_INTERLEAVE,
  SPECIAL_VENDOR_DEEPSEEK,
  type ConnectionCapKey,
} from "./constants"

export interface ConnectionKeyFormState {
  clientId: string
  id?: number
  apiKeyLabel: string
  apiKey: string
  apiKeyMasked: string
  hasStoredApiKey: boolean
  modelIds: string
  enable: boolean
}

export interface ConnectionFormState {
  provider: string
  baseUrl: string
  authType: string
  azureApiVersion: string
  prefixId: string
  tags: string
  connectionType: string
  keys: ConnectionKeyFormState[]
}

const createDraftId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `key-${Math.random().toString(36).slice(2, 10)}`
}

export const createEmptyKey = (index = 0): ConnectionKeyFormState => ({
  clientId: createDraftId(),
  apiKeyLabel: `Key ${index + 1}`,
  apiKey: "",
  apiKeyMasked: "",
  hasStoredApiKey: false,
  modelIds: "",
  enable: true,
})

export const DEFAULT_FORM: ConnectionFormState = {
  provider: "openai",
  baseUrl: "",
  authType: "bearer",
  azureApiVersion: "",
  prefixId: "",
  tags: "",
  connectionType: "external",
  keys: [createEmptyKey(0)],
}

const buildTags = (raw: string) => {
  if (!raw.trim()) return []
  return raw
    .split(",")
    .map((name) => ({ name: name.trim() }))
    .filter((item) => item.name)
}

const buildModelIds = (raw: string) => {
  if (!raw.trim()) return []
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const mapProviderSelection = (
  value: string,
  editingVendor?: string | null,
): Pick<SystemConnectionPayload, "provider" | "vendor"> => {
  if (value === SPECIAL_PROVIDER_OPENAI_INTERLEAVE) {
    return { provider: "openai", vendor: SPECIAL_VENDOR_OPENAI_INTERLEAVE }
  }
  // 旧 deepseek vendor 连接在表单中显示为普通 OpenAI，保存时保留 vendor 避免静默清除
  if (value === "openai" && editingVendor === SPECIAL_VENDOR_DEEPSEEK) {
    return { provider: "openai", vendor: SPECIAL_VENDOR_DEEPSEEK }
  }
  return { provider: value, vendor: undefined }
}

export const buildPayload = (
  form: ConnectionFormState,
  capabilities: Record<ConnectionCapKey, boolean>,
  editingVendor?: string | null,
): SystemConnectionPayload => {
  const { provider, vendor } = mapProviderSelection(form.provider, editingVendor)
  return {
    provider,
    ...(vendor ? { vendor } : {}),
    baseUrl: form.baseUrl.trim(),
    authType: form.authType,
    azureApiVersion: form.azureApiVersion.trim() || undefined,
    prefixId: form.prefixId.trim() || undefined,
    tags: buildTags(form.tags),
    connectionType: form.connectionType,
    defaultCapabilities: capabilities,
    apiKeys: form.keys.map((key) => ({
      ...(key.id ? { id: key.id } : {}),
      apiKeyLabel: key.apiKeyLabel.trim() || undefined,
      apiKey: key.apiKey.trim() || undefined,
      modelIds: buildModelIds(key.modelIds),
      enable: key.enable,
    })),
  }
}

export const createFormFromGroup = (group: SystemConnectionGroup): ConnectionFormState => {
  const providerSelection =
    group.vendor === SPECIAL_VENDOR_OPENAI_INTERLEAVE
      ? SPECIAL_PROVIDER_OPENAI_INTERLEAVE
      : group.provider || "openai"

  return {
    provider: providerSelection,
    baseUrl: group.baseUrl || "",
    authType: group.authType || "bearer",
    azureApiVersion: group.azureApiVersion || "",
    prefixId: group.prefixId || "",
    tags: (group.tags || []).map((item) => item?.name).filter(Boolean).join(","),
    connectionType: group.connectionType || "external",
    keys:
      group.apiKeys?.length > 0
        ? group.apiKeys.map((item, index) => ({
            clientId: String(item.id || createDraftId()),
            id: item.id,
            apiKeyLabel: item.apiKeyLabel || `Key ${index + 1}`,
            apiKey: "",
            apiKeyMasked: item.apiKeyMasked || "",
            hasStoredApiKey: Boolean(item.hasStoredApiKey),
            modelIds: (item.modelIds || []).join(",\n"),
            enable: item.enable ?? true,
          }))
        : [createEmptyKey(0)],
  }
}

export const validateForm = (form: ConnectionFormState, editing: SystemConnectionGroup | null) => {
  if (!form.baseUrl.trim()) return "请填写 Base URL"
  if (form.keys.length === 0) return "至少需要一个 API Key 条目"

  for (let index = 0; index < form.keys.length; index += 1) {
    const key = form.keys[index]
    const label = key.apiKeyLabel.trim() || `Key ${index + 1}`
    if (form.authType === "bearer" && !key.apiKey.trim() && !key.hasStoredApiKey) {
      return `${label} 还没有可用的 API Key`
    }
    if (editing && key.id && !editing.apiKeys.some((item) => item.id === key.id)) {
      return `${label} 的条目状态已过期，请刷新后重试`
    }
  }

  return null
}

