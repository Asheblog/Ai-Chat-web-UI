import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { hasDefinedCapability, parseCapabilityEnvelope as defaultParseCapabilityEnvelope } from '../../utils/capabilities'
import type { CapabilityFlags } from '../../utils/capabilities'
import type { Actor } from '../../types'
import {
  decideModelAccessForActor,
  getModelAccessDefaults as defaultGetModelAccessDefaults,
  parseAccessPolicyFromMeta,
  resolveModelAccessPolicy as defaultResolveModelAccessPolicy,
  type ModelAccessDefaults,
  type ModelAccessPolicy,
  type ModelAccessResolution,
  type ModelAccessTriState,
} from '../../utils/model-access-policy'

type RefreshAllFn = () => Promise<unknown>
type RefreshForConnectionsFn = (connections: Array<{ id: number } & Record<string, any>>) => Promise<unknown>
type RefreshByIdFn = (connectionId: number) => Promise<unknown>
type ComputeCapabilitiesFn = (rawId: string, tags?: Array<{ name: string }>) => CapabilityFlags
type DeriveChannelNameFn = (provider: string, baseUrl?: string) => string
type NormalizeCapabilityFlagsFn = (input: unknown) => CapabilityFlags | undefined
type SerializeCapabilityEnvelopeFn = (input: { flags: CapabilityFlags; source: string }) => string
type InvalidateCacheFn = (connectionId: number, rawId: string) => void
type GetModelAccessDefaultsFn = () => Promise<ModelAccessDefaults>
type ResolveModelAccessPolicyFn = (params: {
  metaJson?: string | null
  defaults: ModelAccessDefaults
}) => { policy: ModelAccessPolicy | null; resolved: ModelAccessResolution }

const parseMetaObject = (metaJson: string | null | undefined): Record<string, any> => {
  if (!metaJson) return {}
  try {
    const parsed = JSON.parse(metaJson)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const extractContextWindow = (metaJson: string | null | undefined): number | null => {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson)
    const raw = (parsed as any)?.context_window
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw)
    }
    const coerced = Number.parseInt(String(raw ?? ''), 10)
    if (Number.isFinite(coerced) && coerced > 0) {
      return Math.floor(coerced)
    }
  } catch {}
  return null
}

const extractMaxOutputTokens = (metaJson: string | null | undefined): number | null => {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson)
    const candidates = [
      (parsed as any)?.custom_max_output_tokens,
      (parsed as any)?.max_output_tokens,
      (parsed as any)?.max_completion_tokens,
      (parsed as any)?.completion_limit,
    ]
    for (const candidate of candidates) {
      const num = typeof candidate === 'number' ? candidate : Number.parseInt(String(candidate ?? ''), 10)
      if (Number.isFinite(num) && num > 0) {
        return num
      }
    }
  } catch {}
  return null
}

const clampMaxOutputTokens = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value < 1) return 0
  if (value > 256_000) return 256_000
  return Math.floor(value)
}

const requireDep = <T>(value: T | undefined, name: string): T => {
  if (!value) {
    throw new Error(`ModelCatalogService dependency '${name}' is required`)
  }
  return value
}

export class ModelCatalogServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ModelCatalogServiceError'
    this.statusCode = statusCode
  }
}

export interface SaveOverridePayload {
  connectionId: number
  rawId: string
  tagsInput?: unknown
  capabilitiesInput?: unknown
  maxOutputTokens?: number | null
  contextWindow?: number | null
  accessPolicyInput?: unknown
}

export interface DeleteOverridesPayload {
  all: boolean
  items?: Array<{ connectionId: number; rawId: string }>
}

export interface ModelCatalogServiceDeps {
  prisma?: PrismaClient
  refreshAllModelCatalog?: RefreshAllFn
  refreshModelCatalogForConnections?: RefreshForConnectionsFn
  refreshModelCatalogForConnectionId?: RefreshByIdFn
  computeCapabilities?: ComputeCapabilitiesFn
  deriveChannelName?: DeriveChannelNameFn
  parseCapabilityEnvelope?: typeof defaultParseCapabilityEnvelope
  normalizeCapabilityFlags?: NormalizeCapabilityFlagsFn
  serializeCapabilityEnvelope?: SerializeCapabilityEnvelopeFn
  invalidateCompletionLimitCache?: InvalidateCacheFn
  invalidateContextWindowCache?: InvalidateCacheFn
  logger?: Pick<typeof console, 'error' | 'warn'>
  now?: () => Date
  getModelAccessDefaults?: GetModelAccessDefaultsFn
  resolveModelAccessPolicy?: ResolveModelAccessPolicyFn
}

export class ModelCatalogService {
  private prisma: PrismaClient
  private refreshAll: RefreshAllFn
  private refreshForConnections: RefreshForConnectionsFn
  private refreshByConnectionId: RefreshByIdFn
  private computeCapabilities: ComputeCapabilitiesFn
  private deriveChannelName: DeriveChannelNameFn
  private parseCapabilityEnvelope: typeof defaultParseCapabilityEnvelope
  private normalizeCapabilityFlags: NormalizeCapabilityFlagsFn
  private serializeCapabilityEnvelopeFn: SerializeCapabilityEnvelopeFn
  private invalidateCompletionLimitCache: InvalidateCacheFn
  private invalidateContextWindowCache: InvalidateCacheFn
  private logger: Pick<typeof console, 'error' | 'warn'>
  private now: () => Date
  private getModelAccessDefaults: GetModelAccessDefaultsFn
  private resolveModelAccessPolicy: ResolveModelAccessPolicyFn

  constructor(deps: ModelCatalogServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.refreshAll = requireDep(deps.refreshAllModelCatalog, 'refreshAllModelCatalog')
    this.refreshForConnections = requireDep(
      deps.refreshModelCatalogForConnections,
      'refreshModelCatalogForConnections',
    )
    this.refreshByConnectionId = requireDep(
      deps.refreshModelCatalogForConnectionId,
      'refreshModelCatalogForConnectionId',
    )
    this.computeCapabilities = requireDep(deps.computeCapabilities, 'computeCapabilities')
    this.deriveChannelName = requireDep(deps.deriveChannelName, 'deriveChannelName')
    this.parseCapabilityEnvelope = deps.parseCapabilityEnvelope ?? defaultParseCapabilityEnvelope
    this.normalizeCapabilityFlags = requireDep(
      deps.normalizeCapabilityFlags,
      'normalizeCapabilityFlags',
    )
    this.serializeCapabilityEnvelopeFn = requireDep(
      deps.serializeCapabilityEnvelope,
      'serializeCapabilityEnvelope',
    )
    this.invalidateCompletionLimitCache = requireDep(
      deps.invalidateCompletionLimitCache,
      'invalidateCompletionLimitCache',
    )
    this.invalidateContextWindowCache = requireDep(
      deps.invalidateContextWindowCache,
      'invalidateContextWindowCache',
    )
    this.logger = deps.logger ?? console
    this.now = deps.now ?? (() => new Date())
    this.getModelAccessDefaults = deps.getModelAccessDefaults ?? defaultGetModelAccessDefaults
    this.resolveModelAccessPolicy = deps.resolveModelAccessPolicy ?? defaultResolveModelAccessPolicy
  }

  async listModels(actor?: Actor) {
    const connections = await this.prisma.connection.findMany({ where: { ownerUserId: null, enable: true } })
    if (connections.length === 0) {
      return []
    }
    const connectionIds = connections.map((item) => item.id)
    const connMap = new Map(connections.map((item) => [item.id, item]))
    const loadRows = () =>
      this.prisma.modelCatalog.findMany({ where: { connectionId: { in: connectionIds } } })

    let rows = await loadRows()
    const now = this.now()
    const needsRefresh: number[] = []
    for (const conn of connections) {
      const related = rows.filter((row) => row.connectionId === conn.id)
      if (related.length === 0) {
        needsRefresh.push(conn.id)
        continue
      }
      const expired = related.every((row) => row.expiresAt <= now)
      if (expired) {
        needsRefresh.push(conn.id)
      }
    }

    if (needsRefresh.length) {
      const targets = connections.filter((conn) => needsRefresh.includes(conn.id))
      await this.refreshForConnections(targets)
      rows = await loadRows()
    }

    const defaults = await this.getModelAccessDefaults()
    const actorType = (() => {
      if (!actor) return 'anonymous' as const
      if (actor.type === 'user' && actor.role === 'ADMIN') return 'admin' as const
      return actor.type
    })()

    const mapped = rows
      .filter((row) => connMap.has(row.connectionId))
      .map((row) => {
        const conn = connMap.get(row.connectionId)!
        let tags: Array<{ name: string }> = []
        try {
          const parsed = JSON.parse(row.tagsJson || '[]')
          tags = Array.isArray(parsed) ? parsed : []
        } catch {
          tags = []
        }
        const contextWindow = extractContextWindow(row.metaJson)
        const maxOutputTokens = extractMaxOutputTokens(row.metaJson)
        const storedCaps = this.parseCapabilityEnvelope(row.capabilitiesJson)
        let capabilities = storedCaps?.flags
        let capabilitySource = storedCaps?.source ?? null
        if (!storedCaps || !hasDefinedCapability(capabilities)) {
          const fallback = this.computeCapabilities(row.rawId, tags)
          if (hasDefinedCapability(fallback)) {
            capabilities = fallback
            capabilitySource = 'legacy'
          } else {
            capabilities = undefined
            capabilitySource = null
          }
        }

        const accessInfo = this.resolveModelAccessPolicy({ metaJson: row.metaJson, defaults })
        const decision = decideModelAccessForActor(actor ?? { type: actorType }, accessInfo.resolved)

        return {
          id: row.modelId,
          rawId: row.rawId,
          name: row.name,
          provider: row.provider,
          channelName: this.deriveChannelName(conn.provider as any, conn.baseUrl),
          connectionBaseUrl: conn.baseUrl,
          connectionId: row.connectionId,
          connectionType: row.connectionType,
          tags,
          capabilities,
          capabilitySource: capabilitySource || undefined,
          overridden: row.manualOverride,
          contextWindow,
          maxOutputTokens,
          accessPolicy: accessInfo.policy ?? undefined,
          resolvedAccess: accessInfo.resolved,
          accessDecision: decision,
        }
      })

    if (actorType === 'admin') {
      return mapped
    }

    return mapped.filter((item) => item.accessDecision === 'allow')
  }

  async refreshAllModels() {
    await this.refreshAll()
  }

  async saveOverride(payload: SaveOverridePayload) {
    const connectionId = payload.connectionId
    const rawId = (payload.rawId || '').trim()
    if (!connectionId || !rawId) {
      throw new ModelCatalogServiceError('connectionId/rawId required')
    }
    const connection = await this.prisma.connection.findUnique({ where: { id: connectionId } })
    if (!connection) {
      throw new ModelCatalogServiceError('Connection not found', 404)
    }

    const hasTagsPayload = Array.isArray(payload.tagsInput)
    const tags = hasTagsPayload ? this.normalizeTags(payload.tagsInput as any[]) : undefined
    const hasCapabilitiesPayload = payload.capabilitiesInput != null
    const capabilityFlags = hasCapabilitiesPayload
      ? this.normalizeCapabilityFlags(payload.capabilitiesInput)
      : undefined
    const capabilitiesJson = hasCapabilitiesPayload
      ? this.serializeCapabilityEnvelopeFn({ flags: capabilityFlags || {}, source: 'manual' })
      : undefined
    const ttlSec = Number.parseInt(process.env.MODELS_TTL_S || '120', 10) || 120
    const now = this.now()
    const expiresAt = new Date(now.getTime() + ttlSec * 1000)
    const modelId = (connection.prefixId ? `${connection.prefixId}.` : '') + rawId

    const existing = await this.prisma.modelCatalog.findFirst({ where: { connectionId, modelId } })
    const metaPayload = parseMetaObject(existing?.metaJson)

    if (Object.prototype.hasOwnProperty.call(payload, 'maxOutputTokens')) {
      if (payload.maxOutputTokens == null) {
        delete metaPayload.custom_max_output_tokens
      } else {
        const value = clampMaxOutputTokens(payload.maxOutputTokens)
        if (value <= 0) {
          throw new ModelCatalogServiceError('max_output_tokens must be positive')
        }
        metaPayload.custom_max_output_tokens = value
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'contextWindow')) {
      if (payload.contextWindow == null) {
        delete metaPayload.context_window
      } else {
        const numeric = Number.parseInt(String(payload.contextWindow), 10)
        if (!Number.isFinite(numeric) || numeric <= 0) {
          throw new ModelCatalogServiceError('context_window must be positive')
        }
        metaPayload.context_window = numeric
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'accessPolicyInput')) {
      const normalized = this.normalizeAccessPolicyInput(payload.accessPolicyInput)
      if (normalized) {
        metaPayload.access_policy = normalized
      } else {
        delete metaPayload.access_policy
      }
    }

    const metaJson = JSON.stringify(metaPayload)

    if (!existing) {
      await this.prisma.modelCatalog.create({
        data: {
          connectionId,
          modelId,
          rawId,
          name: rawId,
          provider: connection.provider,
          connectionType: (connection.connectionType as any) || 'external',
          tagsJson: JSON.stringify(tags || []),
          capabilitiesJson: capabilitiesJson || '{}',
          metaJson,
          manualOverride: true,
          lastFetchedAt: now,
          expiresAt,
        },
      })
    } else {
      const updateData: Prisma.ModelCatalogUpdateInput = {
        metaJson,
        manualOverride: true,
        lastFetchedAt: now,
        expiresAt,
      }
      if (hasTagsPayload) {
        updateData.tagsJson = JSON.stringify(tags || [])
      }
      if (capabilitiesJson) {
        updateData.capabilitiesJson = capabilitiesJson
      }
      await this.prisma.modelCatalog.update({ where: { id: existing.id }, data: updateData })
    }

    this.invalidateCompletionLimitCache(connectionId, rawId)
    this.invalidateContextWindowCache(connectionId, rawId)
  }

  async deleteOverrides(payload: DeleteOverridesPayload) {
    if (payload.all) {
      const result = await this.prisma.modelCatalog.deleteMany({ where: { manualOverride: true } })
      await this.refreshAll()
      return result.count
    }
    const items = Array.isArray(payload.items) ? payload.items : []
    if (!items.length) {
      throw new ModelCatalogServiceError('items required')
    }
    const normalized = items
      .map((item) => ({
        connectionId: Number(item.connectionId),
        rawId: String(item.rawId || ''),
      }))
      .filter((item) => Number.isFinite(item.connectionId) && item.connectionId > 0 && item.rawId)
    if (!normalized.length) {
      throw new ModelCatalogServiceError('items required')
    }

    const connectionIds = Array.from(new Set(normalized.map((item) => item.connectionId)))
    const connections = await this.prisma.connection.findMany({
      where: { id: { in: connectionIds } },
      select: { id: true, prefixId: true },
    })
    const prefixMap = new Map(connections.map((c) => [c.id, c.prefixId]))
    const filters = normalized.map((item) => {
      const prefix = prefixMap.get(item.connectionId) || ''
      const modelId = prefix ? `${prefix}.${item.rawId}` : item.rawId
      return { connectionId: item.connectionId, modelId }
    })
    const result = await this.prisma.modelCatalog.deleteMany({ where: { OR: filters, manualOverride: true } })
    for (const id of connectionIds) {
      await this.refreshByConnectionId(id)
    }
    return result.count
  }

  async exportOverrides() {
    const rows = await this.prisma.modelCatalog.findMany({
      where: { manualOverride: true },
      select: {
        connectionId: true,
        rawId: true,
        modelId: true,
        tagsJson: true,
        capabilitiesJson: true,
        metaJson: true,
      },
    })
    return rows.map((row) => {
      const tags = (() => {
        try {
          const parsed = JSON.parse(row.tagsJson || '[]')
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      })()
      const parsedCaps = this.parseCapabilityEnvelope(row.capabilitiesJson)
      return {
        connectionId: row.connectionId,
        rawId: row.rawId,
        modelId: row.modelId,
        tags,
        capabilities: parsedCaps?.flags || undefined,
        capabilitySource: parsedCaps?.source || null,
        accessPolicy: parseAccessPolicyFromMeta(row.metaJson) || undefined,
      }
    })
  }

  private normalizeAccessPolicyInput(input: unknown): ModelAccessPolicy | null {
    if (input === null || input === undefined) return null
    if (typeof input !== 'object') {
      throw new ModelCatalogServiceError('access_policy must be an object or null')
    }
    const payload = input as Record<string, any>
    const allowed: ModelAccessPolicy = {}
    const accepts = (value: any): value is ModelAccessTriState =>
      value === 'allow' || value === 'deny' || value === 'inherit'
    if (accepts(payload.anonymous)) allowed.anonymous = payload.anonymous
    if (accepts(payload.user)) allowed.user = payload.user
    return Object.keys(allowed).length ? allowed : null
  }

  private normalizeTags(input: any[]): Array<{ name: string }> {
    return input
      .map((tag) => {
        if (!tag) return null
        if (typeof tag === 'string') {
          const trimmed = tag.trim()
          return trimmed ? { name: trimmed } : null
        }
        if (typeof tag === 'object' && typeof tag.name === 'string') {
          const trimmed = tag.name.trim()
          return trimmed ? { name: trimmed } : null
        }
        return null
      })
      .filter((tag): tag is { name: string } => Boolean(tag))
  }
}
