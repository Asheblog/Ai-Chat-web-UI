export const CAPABILITY_KEYS = ['vision', 'file_upload', 'web_search', 'image_generation', 'code_interpreter'] as const

export type CapabilityKey = typeof CAPABILITY_KEYS[number]
export type CapabilityFlags = Partial<Record<CapabilityKey, boolean>>
export type CapabilitySource = 'manual' | 'connection_default' | 'provider' | 'heuristic' | 'tags' | 'legacy' | 'unknown'

export interface CapabilityEnvelope {
  flags: CapabilityFlags
  source?: CapabilitySource | null
}

const truthyStrings = new Set(['true', '1', 'yes', 'y'])
const falsyStrings = new Set(['false', '0', 'no', 'n'])

const normalizeValue = (value: any): boolean | undefined => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (truthyStrings.has(lowered)) return true
    if (falsyStrings.has(lowered)) return false
  }
  return undefined
}

export const isCapabilityKey = (value: string): value is CapabilityKey => {
  return (CAPABILITY_KEYS as readonly string[]).includes(value)
}

export const normalizeCapabilityFlags = (input?: Record<string, any> | null): CapabilityFlags => {
  const flags: CapabilityFlags = {}
  if (!input || typeof input !== 'object') return flags
  for (const key of Object.keys(input)) {
    if (!isCapabilityKey(key)) continue
    const normalized = normalizeValue((input as Record<string, any>)[key])
    if (normalized !== undefined) {
      flags[key as CapabilityKey] = normalized
    }
  }
  return flags
}

export const hasDefinedCapability = (flags?: CapabilityFlags | null): boolean => {
  if (!flags) return false
  return CAPABILITY_KEYS.some((key) => flags[key] !== undefined)
}

export const createCapabilityEnvelope = (flags?: CapabilityFlags | null, source?: CapabilitySource): CapabilityEnvelope | null => {
  if (!flags) return null
  if (!hasDefinedCapability(flags)) return null
  return { flags, source }
}

export const mergeCapabilityLayers = (layers: Array<{ flags?: CapabilityFlags | null; source?: CapabilitySource }>): CapabilityEnvelope | null => {
  let merged: CapabilityFlags = {}
  let mergedSource: CapabilitySource | null | undefined = null
  let touched = false
  for (const layer of layers) {
    if (!layer?.flags) continue
    let layerTouched = false
    for (const key of CAPABILITY_KEYS) {
      const value = layer.flags[key]
      if (value === undefined) continue
      merged[key] = value
      touched = true
      layerTouched = true
    }
    if (layerTouched) {
      mergedSource = layer.source ?? mergedSource ?? null
    }
  }
  if (!touched) return null
  return { flags: merged, source: mergedSource ?? null }
}

export const parseCapabilityEnvelope = (raw?: string | null): CapabilityEnvelope | null => {
  if (!raw || !raw.trim() || raw.trim() === '{}') return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const flags = normalizeCapabilityFlags(parsed.flags ?? parsed)
    const source = typeof parsed.source === 'string' ? (parsed.source as CapabilitySource) : undefined
    return createCapabilityEnvelope(flags, source)
  } catch {
    return null
  }
}

export const serializeCapabilityEnvelope = (env?: CapabilityEnvelope | null): string => {
  if (!env) return '{}'
  return JSON.stringify(env)
}
