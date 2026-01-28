import {
  deleteAllModelOverrides as deleteAllModelOverridesApi,
  deleteModelOverrides as deleteModelOverridesApi,
  refreshModelCatalog as refreshModelCatalogApi,
  updateModelTags,
} from '@/features/system/api'

export async function updateModelCapabilities(
  connectionId: number,
  rawId: string,
  options: {
    tags?: Array<{ name: string }>
    capabilities?: Record<string, boolean>
    maxOutputTokens?: number | null
    contextWindow?: number | null
    temperature?: number | null
    accessPolicy?: { anonymous?: 'allow' | 'deny' | 'inherit'; user?: 'allow' | 'deny' | 'inherit' } | null
  }
) {
  return updateModelTags(connectionId, rawId, options)
}

export async function refreshModelCatalog() {
  return refreshModelCatalogApi()
}

export async function deleteModelOverrides(items: Array<{ connectionId: number; rawId: string }>) {
  return deleteModelOverridesApi(items)
}

export async function deleteAllModelOverrides() {
  return deleteAllModelOverridesApi()
}
