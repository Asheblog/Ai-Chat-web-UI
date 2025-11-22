import { apiClient } from "@/lib/api"

export async function updateModelCapabilities(
  connectionId: number,
  rawId: string,
  options: {
    tags?: Array<{ name: string }>
    capabilities?: Record<string, boolean>
    maxOutputTokens?: number | null
    accessPolicy?: { anonymous?: 'allow' | 'deny' | 'inherit'; user?: 'allow' | 'deny' | 'inherit' } | null
  }
) {
  return apiClient.updateModelTags(connectionId, rawId, options)
}

export async function refreshModelCatalog() {
  return apiClient.refreshModelCatalog()
}

export async function deleteModelOverrides(items: Array<{ connectionId: number; rawId: string }>) {
  return apiClient.deleteModelOverrides(items)
}

export async function deleteAllModelOverrides() {
  return apiClient.deleteAllModelOverrides()
}
