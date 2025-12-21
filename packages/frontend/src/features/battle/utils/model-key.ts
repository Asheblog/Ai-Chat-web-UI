export type ModelKeySource = {
  id: string
  connectionId?: number | null
  rawId?: string | null
}

export type ModelKeyRef = {
  modelId: string
  connectionId?: number | null
  rawId?: string | null
}

export type ParsedModelKey =
  | { type: 'global'; modelId: string }
  | { type: 'connection'; connectionId: number; rawId: string }

export const buildModelKey = (ref: ModelKeyRef): string => {
  if (ref.connectionId != null && ref.rawId) {
    return `${ref.connectionId}:${ref.rawId}`
  }
  return `global:${ref.modelId}`
}

export const modelKeyFor = (model: ModelKeySource): string =>
  buildModelKey({
    modelId: model.id,
    connectionId: model.connectionId ?? null,
    rawId: model.rawId ?? null,
  })

export const parseModelKey = (modelKey: string): ParsedModelKey | null => {
  if (!modelKey) return null
  if (modelKey.startsWith('global:')) {
    const modelId = modelKey.slice('global:'.length)
    return modelId ? { type: 'global', modelId } : null
  }
  const [connIdRaw, ...rawParts] = modelKey.split(':')
  const connectionId = Number.parseInt(connIdRaw, 10)
  const rawId = rawParts.join(':')
  if (!Number.isFinite(connectionId) || !rawId) return null
  return { type: 'connection', connectionId, rawId }
}
