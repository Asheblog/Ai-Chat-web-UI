import { apiClient } from "@/lib/api"

export async function updateModelCapabilities(connectionId: number, rawId: string, tags: Array<{ name: string }>, capabilities?: Record<string, boolean>) {
  return apiClient.updateModelTags(connectionId, rawId, tags, capabilities)
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
