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
