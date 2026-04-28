import { deriveChannelName } from "@/lib/utils"
import type { SystemConnectionGroup } from "@/services/system-connections"
import { SPECIAL_VENDOR_DEEPSEEK, SPECIAL_VENDOR_OPENAI_INTERLEAVE } from "./constants"

export type HealthState = "healthy" | "warning" | "error"
export type DetailIntent = "view" | "create"
export type EditorFocus = "basic" | "advanced" | "keys" | "verify"

export const STATUS_FILTERS = [
  { value: "all", label: "全部状态" },
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "禁用" },
]

export const HEALTH_FILTERS = [
  { value: "all", label: "全部健康" },
  { value: "healthy", label: "健康" },
  { value: "warning", label: "警告" },
  { value: "error", label: "异常" },
]

export const healthLabel: Record<HealthState, string> = {
  healthy: "健康",
  warning: "警告",
  error: "异常",
}

export function providerLabel(group: Pick<SystemConnectionGroup, "provider" | "vendor">) {
  if (group.vendor === SPECIAL_VENDOR_OPENAI_INTERLEAVE) return "OpenAI（交错思考）"
  if (group.vendor === SPECIAL_VENDOR_DEEPSEEK) return "DeepSeek"
  if (group.provider === "azure_openai") return "Azure"
  if (group.provider === "google_genai") return "Google"
  if (group.provider === "ollama") return "Ollama"
  if (group.provider === "openai_responses") return "OpenAI Responses"
  if (group.provider === "openai") return "OpenAI"
  return group.provider || "Provider"
}

export function getEnabledKeyCount(group: SystemConnectionGroup) {
  return group.apiKeys.filter((key) => key.enable).length
}

export function getGroupHealth(group: SystemConnectionGroup): HealthState {
  if (group.apiKeys.length === 0) return "error"
  const enabledCount = getEnabledKeyCount(group)
  if (enabledCount === 0) return "error"
  if (enabledCount < group.apiKeys.length) return "warning"
  return "healthy"
}

export function getModelCount(group: SystemConnectionGroup) {
  const models = new Set<string>()
  group.apiKeys.forEach((key) => key.modelIds.forEach((id) => models.add(id)))
  return models.size
}

export function baseUrlPlaceholder(provider: string) {
  if (provider === "ollama") return "http://localhost:11434"
  if (provider === "google_genai") return "https://generativelanguage.googleapis.com/v1beta"
  return "https://api.openai.com/v1"
}

export function filterConnections({
  connections,
  healthFilter,
  providerFilter,
  query,
  statusFilter,
}: {
  connections: SystemConnectionGroup[]
  healthFilter: string
  providerFilter: string
  query: string
  statusFilter: string
}) {
  const normalizedQuery = query.trim().toLowerCase()

  return connections.filter((group) => {
    const providerKey = `${group.provider}:${group.vendor || ""}`
    if (providerFilter !== "all" && providerKey !== providerFilter) return false

    const enabledCount = getEnabledKeyCount(group)
    if (statusFilter === "enabled" && enabledCount === 0) return false
    if (statusFilter === "disabled" && enabledCount > 0) return false

    const health = getGroupHealth(group)
    if (healthFilter !== "all" && health !== healthFilter) return false

    if (!normalizedQuery) return true
    const searchable = [
      providerLabel(group),
      group.provider,
      group.baseUrl,
      group.prefixId ?? "",
      deriveChannelName(group.provider, group.baseUrl),
      ...group.tags.map((tag) => tag.name),
      ...group.apiKeys.map((key) => key.apiKeyLabel || ""),
    ]
    return searchable.some((value) => value.toLowerCase().includes(normalizedQuery))
  })
}

