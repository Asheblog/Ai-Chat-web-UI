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
import type { ProviderTemplate } from "./provider-templates"

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
  displayName: string
  provider: string
  baseUrl: string
  authType: string
  headers: string
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
  displayName: "",
  provider: "openai",
  baseUrl: "",
  authType: "bearer",
  headers: "",
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

const serializeHeaders = (headers?: Record<string, string> | null) => {
  if (!headers || Object.keys(headers).length === 0) return ""
  try {
    return JSON.stringify(headers, null, 2)
  } catch {
    return ""
  }
}

const parseHeaders = (raw: string): Record<string, string> | undefined => {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("headers must be an object")
    }
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        throw new Error("header values must be strings")
      }
      result[key] = value
    }
    return result
  } catch {
    throw new Error("Headers 需为 JSON 对象，例如 {\"X-Custom\":\"value\"}")
  }
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
  const headers = parseHeaders(form.headers)
  return {
    displayName: form.displayName.trim(),
    provider,
    ...(vendor ? { vendor } : {}),
    baseUrl: form.baseUrl.trim(),
    authType: form.authType,
    ...(headers ? { headers } : {}),
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
    displayName: group.displayName || "",
    provider: providerSelection,
    baseUrl: group.baseUrl || "",
    authType: group.authType || "bearer",
    headers: serializeHeaders(group.headers),
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

export const createFormFromTemplate = (template: ProviderTemplate): ConnectionFormState => ({
  // openai_interleave 直接作 provider 值，沿用 mapProviderSelection 语义（其即 provider 选项值）
  displayName: template.label,
  provider: template.provider,
  baseUrl: template.baseUrl,
  authType: template.authType,
  headers: "",
  prefixId: "",
  tags: "",
  connectionType: "external",
  keys: [createEmptyKey(0)],
})

export const validateForm = (form: ConnectionFormState, editing: SystemConnectionGroup | null) => {
  if (!form.displayName.trim()) return "请填写显示名称"
  if (!form.baseUrl.trim()) return "请填写 Base URL"
  if (form.keys.length === 0) return "至少需要一个 API Key 条目"

  try {
    parseHeaders(form.headers)
  } catch (error) {
    return error instanceof Error ? error.message : "Headers 格式无效"
  }

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

/** 仅校验向导第 2 步基础字段（进入验证步前） */
export const validateBasicFields = (form: ConnectionFormState) => {
  if (!form.displayName.trim()) return "请填写显示名称"
  if (!form.baseUrl.trim()) return "请填写 Base URL"
  if (form.keys.length === 0) return "至少需要一个 API Key 条目"
  for (let index = 0; index < form.keys.length; index += 1) {
    const key = form.keys[index]
    const label = key.apiKeyLabel.trim() || `Key ${index + 1}`
    if (form.authType === "bearer" && !key.apiKey.trim() && !key.hasStoredApiKey) {
      return `${label} 还没有可用的 API Key`
    }
  }
  return null
}
