import type { SystemConnectionGroup } from "@/services/system-connections"
import { ANTHROPIC_BASE_URL } from "./provider-templates"

export type HealthState = "healthy" | "warning" | "error"
export type WizardMode = "create" | "edit"
export type WizardStep = 1 | 2 | 3
export type EditorFocus = "basic" | "advanced" | "keys" | "verify"

export const healthLabel: Record<HealthState, string> = {
  healthy: "健康",
  warning: "警告",
  error: "异常",
}

export function providerLabel(group: Pick<SystemConnectionGroup, "provider">) {
  if (group.provider === "google_genai") return "Google"
  if (group.provider === "anthropic") return "Anthropic"
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
  if (provider === "google_genai") return "https://generativelanguage.googleapis.com/v1beta"
  if (provider === "anthropic") return ANTHROPIC_BASE_URL
  return "https://api.openai.com/v1"
}

export function connectionSecondaryLine(group: SystemConnectionGroup) {
  return `${providerLabel(group)} · ${group.baseUrl}`
}