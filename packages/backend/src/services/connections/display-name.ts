import { deriveChannelName, type ProviderType } from '../../utils/providers'

type DisplayNameSeedInput = {
  prefixId?: string | null
  provider: string
  baseUrl?: string | null
}

type ModelOptionLabelInput = {
  name: string
  displayName?: string | null
  provider: string
}

const nonEmpty = (value?: string | null) => value?.trim() || ''

export const seedDisplayName = ({ prefixId, provider, baseUrl }: DisplayNameSeedInput): string =>
  nonEmpty(prefixId) ||
  nonEmpty(deriveChannelName(provider as ProviderType, baseUrl || undefined)) ||
  nonEmpty(provider) ||
  'Connection'

export const allocateUniqueDisplayName = (seed: string, taken: Set<string>): string => {
  const normalizedSeed = nonEmpty(seed) || 'Connection'
  if (!taken.has(normalizedSeed)) return normalizedSeed

  let suffix = 2
  while (taken.has(`${normalizedSeed}-${suffix}`)) {
    suffix += 1
  }
  return `${normalizedSeed}-${suffix}`
}

export const formatModelOptionLabel = ({
  name,
  displayName,
  provider,
}: ModelOptionLabelInput): string => {
  const modelName = nonEmpty(name) || nonEmpty(provider) || 'Unknown model'
  const groupName = nonEmpty(displayName) || nonEmpty(provider)
  return groupName ? `${modelName} · ${groupName}` : modelName
}
