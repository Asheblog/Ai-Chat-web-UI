/**
 * 模型展示名 / 渠道名工具 —— backend / frontend 共用（RN 安全）。
 *
 * 收敛两份重复实现：
 * - deriveChannelName：backend utils/providers.ts 与 frontend lib/utils.ts
 * - formatModelOptionLabel：backend services/connections/display-name.ts 与 frontend lib/model-display.ts
 */

const CHANNEL_PREFIX_BLACKLIST = new Set([
  'api',
  'app',
  'prod',
  'dev',
  'test',
  'staging',
  'stage',
  'ai',
  'llm',
  'model',
  'models',
  'gateway',
  'gw',
])
const GENERIC_TLDS = new Set([
  'com',
  'net',
  'org',
  'gov',
  'edu',
  'co',
  'ai',
  'io',
  'app',
  'dev',
  'cn',
  'uk',
])

const nonEmpty = (value?: string | null) => value?.trim() || ''

function parseUrlCandidate(input?: string): URL | null {
  if (!input) return null
  const tryParse = (value: string): URL | null => {
    try {
      return new URL(value)
    } catch {
      return null
    }
  }
  const direct = tryParse(input)
  if (direct) return direct
  if (!/^https?:\/\//i.test(input)) {
    return tryParse(`https://${input}`)
  }
  return null
}

/** 从 provider + baseUrl 推导稳定的渠道名。 */
export function deriveChannelName(provider: string, baseUrl?: string): string {
  const fallback = provider
  const parsed = parseUrlCandidate(baseUrl)
  if (!parsed) return fallback

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) return fallback

  let parts = hostname.split('.').filter(Boolean)
  if (parts.length > 1 && CHANNEL_PREFIX_BLACKLIST.has(parts[0])) {
    parts = parts.slice(1)
  }

  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0]

  let candidate = parts[parts.length - 2]
  if (GENERIC_TLDS.has(candidate) && parts.length >= 3) {
    candidate = parts[parts.length - 3]
  }

  candidate = candidate || parts[parts.length - 1]
  if (!candidate || candidate.length < 2) return fallback
  return candidate
}

export type ModelDisplaySource = {
  name?: string | null
  displayName?: string | null
  provider?: string | null
}

/** Human-readable provider label for secondary lines. */
export const modelProviderLabel = (provider?: string | null): string => {
  const value = nonEmpty(provider)
  if (!value) return ''
  if (value === 'google_genai') return 'Google'
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
  models: Array<Pick<ModelDisplaySource, 'name'>>,
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

type DisplayNameSeedInput = {
  prefixId?: string | null
  provider: string
  baseUrl?: string | null
}

export const seedDisplayName = ({ prefixId, provider, baseUrl }: DisplayNameSeedInput): string =>
  nonEmpty(prefixId) ||
  nonEmpty(deriveChannelName(provider, baseUrl || undefined)) ||
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
