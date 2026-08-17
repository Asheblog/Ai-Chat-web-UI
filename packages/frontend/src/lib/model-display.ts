/** Shared model label helpers (mirrors backend formatModelOptionLabel). */

const nonEmpty = (value?: string | null) => value?.trim() || ''

export type ModelDisplaySource = {
  name?: string | null
  displayName?: string | null
  provider?: string | null
}

/** Human-readable provider label for secondary lines. */
export const modelProviderLabel = (provider?: string | null): string => {
  const value = nonEmpty(provider)
  if (!value) return ''
  if (value === 'azure_openai') return 'Azure'
  if (value === 'google_genai') return 'Google'
  if (value === 'ollama') return 'Ollama'
  if (value === 'openai_responses') return 'OpenAI Responses'
  if (value === 'openai') return 'OpenAI'
  return value
}

/** Accessible full label: `${name} · ${displayName}`. */
export const formatModelOptionLabel = ({
  name,
  displayName,
  provider,
}: ModelDisplaySource): string => {
  const modelName = nonEmpty(name) || nonEmpty(provider) || 'Unknown model'
  const groupName = nonEmpty(displayName) || nonEmpty(provider)
  return groupName ? `${modelName} · ${groupName}` : modelName
}

/** Visual secondary line: `displayName · providerLabel`. */
export const formatModelSecondaryLabel = ({
  displayName,
  provider,
}: Pick<ModelDisplaySource, 'displayName' | 'provider'>): string => {
  const group = nonEmpty(displayName)
  const providerText = modelProviderLabel(provider)
  if (group && providerText) return `${group} · ${providerText}`
  return group || providerText
}

export const collectDuplicateModelNames = (
  models: Array<Pick<ModelDisplaySource, 'name'>>
): Set<string> => {
  const counts = new Map<string, number>()
  for (const model of models) {
    const name = nonEmpty(model.name)
    if (!name) continue
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  const duplicates = new Set<string>()
  for (const [name, count] of counts) {
    if (count > 1) duplicates.add(name)
  }
  return duplicates
}
