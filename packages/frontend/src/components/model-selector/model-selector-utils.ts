import type { ModelItem } from '@/store/models-store'
import { modelKeyFor } from '@/store/model-preference-store'
import { formatModelSecondaryLabel } from '@/lib/model-display'

export const isModelSelected = (model: ModelItem, selectedModelId: string | null): boolean => {
  return selectedModelId === modelKeyFor(model)
}

/** Preserve connection names while avoiding a repeated provider in this picker. */
export const formatModelSelectorSource = (model: ModelItem): string => {
  const displayName = model.displayName?.trim()
  const supplier = formatModelSecondaryLabel({ provider: model.provider })
  return displayName && displayName.toLowerCase() === supplier.toLowerCase()
    ? displayName
    : formatModelSecondaryLabel(model)
}

/** Search the supplied catalog without changing its order, identity or eligibility. */
export const filterModels = (models: ModelItem[], searchTerm: string): ModelItem[] => {
  const query = searchTerm.trim().toLowerCase()
  if (!query) return models
  return models.filter(model => {
    const content = [model.name, model.id, model.rawId, model.provider, formatModelSecondaryLabel(model)].join(' ').toLowerCase()
    return content.includes(query)
  })
}
/**
 * 仅影响触发器可见文本的短名：当首个词是纯字母厂商标识、且其余部分带版本号时才省略厂商。
 * 无法可靠缩短的名称原样返回，交给触发器截断；完整名称始终保留在 title、列表与可访问描述中。
 */
export const formatModelShortName = (name: string): string => {
  const tokens = name.trim().split(/\s+/)
  if (tokens.length < 2) return name
  const [vendor, ...rest] = tokens
  const vendorIsBareWord = /^[A-Za-z][A-Za-z.+#-]*$/.test(vendor) && !/\d/.test(vendor)
  const restCarriesVersion = rest.some((token) => /\d/.test(token))
  return vendorIsBareWord && restCarriesVersion ? rest.join(' ') : name
}
