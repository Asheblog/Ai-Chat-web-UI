import {
  deleteAllModelOverrides as deleteAllModelOverridesApi,
  deleteModelOverrides as deleteModelOverridesApi,
  refreshModelCatalog as refreshModelCatalogApi,
  saveModelOverride,
  type ModelOverrideField,
} from '@/api/system'

export type { ModelOverrideField }

/** 模型覆写保存：能力 / 生成参数 / 访问策略各自独立，未传的字段不动。 */
export async function updateModelCapabilities(
  connectionId: number,
  rawId: string,
  options: {
    capabilities?: Record<string, boolean>
    maxOutputTokens?: number | null
    contextWindow?: number | null
    temperature?: number | null
    accessPolicy?: { anonymous?: 'allow' | 'deny' | 'inherit'; user?: 'allow' | 'deny' | 'inherit' } | null
  }
) {
  return saveModelOverride(connectionId, rawId, options)
}

export async function refreshModelCatalog() {
  return refreshModelCatalogApi()
}

/** fields 缺省表示清除该模型的全部覆写；否则只清所选范围。 */
export async function deleteModelOverrides(
  items: Array<{ connectionId: number; rawId: string; fields?: ModelOverrideField[] }>,
) {
  return deleteModelOverridesApi(items)
}

export async function deleteAllModelOverrides() {
  return deleteAllModelOverridesApi()
}
