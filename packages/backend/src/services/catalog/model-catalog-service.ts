import type { Connection, ConnectionGroup, Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { hasDefinedCapability, parseCapabilityEnvelope as defaultParseCapabilityEnvelope } from '../../utils/capabilities'
import type { CapabilityEnvelope, CapabilityFlags } from '../../utils/capabilities'
import type { Actor } from '../../types'
import { isSupportedProvider, SUPPORTED_PROVIDERS, type ProviderType } from '../../utils/providers'
import {
  ALL_OVERRIDE_FIELDS,
  clearModelOverrides,
  isOverrideField,
  parseModelMeta,
  readModelContextWindow,
  readModelMaxOutputTokens,
  readModelOverrideState,
  readModelTemperature,
  setModelParameterOverride,
  type ModelOverrideField,
} from './model-override'
import { resolveSupportedEfforts } from './model-generation-parameters'
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

type ConnectionGroupWithCredentials = ConnectionGroup & { credentials: Connection[] }

type RefreshAllFn = () => Promise<unknown>
type RefreshForGroupsFn = (groups: ConnectionGroupWithCredentials[]) => Promise<unknown>
type RefreshByGroupIdFn = (connectionGroupId: number) => Promise<unknown>
type ComputeCapabilitiesFn = (rawId: string) => CapabilityFlags
type DeriveChannelNameFn = (provider: ProviderType, baseUrl?: string) => string
type NormalizeCapabilityFlagsFn = (input?: Record<string, any> | null) => CapabilityFlags | undefined
type SerializeCapabilityEnvelopeFn = (input?: CapabilityEnvelope | null) => string
type InvalidateCacheFn = (connectionGroupId: number, rawId: string) => void
type GetModelAccessDefaultsFn = () => Promise<ModelAccessDefaults>
type ResolveModelAccessPolicyFn = (params: {
  metaJson?: string | null
  defaults: ModelAccessDefaults
}) => { policy: ModelAccessPolicy | null; resolved: ModelAccessResolution }

const extractContextWindow = (metaJson: string | null | undefined): number | null =>
  readModelContextWindow(parseModelMeta(metaJson))

const extractMaxOutputTokens = (metaJson: string | null | undefined): number | null =>
  readModelMaxOutputTokens(parseModelMeta(metaJson))

const extractTemperature = (metaJson: string | null | undefined): number | null =>
  readModelTemperature(parseModelMeta(metaJson))

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
  /** Stable connection group id (API still names this connectionId). */
  connectionId: number
  rawId: string
  capabilitiesInput?: unknown
  maxOutputTokens?: number | null
  contextWindow?: number | null
  temperature?: number | null
  accessPolicyInput?: unknown
}

export interface DeleteOverridesPayload {
  all: boolean
  /** fields 缺省或为空表示清除该模型的全部覆写（删除整行后重新探测）。 */
  items?: Array<{ connectionId: number; rawId: string; fields?: ModelOverrideField[] }>
}

export interface ModelCatalogServiceDeps {
  prisma?: PrismaClient
  refreshAllModelCatalog?: RefreshAllFn
  refreshModelCatalogForConnectionGroups?: RefreshForGroupsFn
  refreshModelCatalogForConnectionGroupId?: RefreshByGroupIdFn
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
  private refreshForGroups: RefreshForGroupsFn
  private refreshByGroupId: RefreshByGroupIdFn
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
    this.refreshForGroups = requireDep(
      deps.refreshModelCatalogForConnectionGroups,
      'refreshModelCatalogForConnectionGroups',
    )
    this.refreshByGroupId = requireDep(
      deps.refreshModelCatalogForConnectionGroupId,
      'refreshModelCatalogForConnectionGroupId',
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
    const candidates = await this.prisma.connectionGroup.findMany({
      where: { ownerUserId: null, enable: true, provider: { in: [...SUPPORTED_PROVIDERS] } },
      include: { credentials: true },
    })
    const groups = candidates.filter((group) => isSupportedProvider(group.provider))
    if (groups.length === 0) {
      return []
    }
    const groupIds = groups.map((item) => item.id)
    const groupMap = new Map(groups.map((item) => [item.id, item]))
    const loadRows = () =>
      this.prisma.modelCatalog.findMany({ where: { connectionGroupId: { in: groupIds } } })

    let rows = await loadRows()
    const now = this.now()
    const needsRefresh: number[] = []
    for (const group of groups) {
      const related = rows.filter((row) => row.connectionGroupId === group.id)
      if (related.length === 0) {
        needsRefresh.push(group.id)
        continue
      }
      const expired = related.every((row) => row.expiresAt <= now)
      if (expired) {
        needsRefresh.push(group.id)
      }
    }

    if (needsRefresh.length) {
      const targets = groups.filter((group) => needsRefresh.includes(group.id))
      await this.refreshForGroups(targets)
      rows = await loadRows()
    }

    const defaults = await this.getModelAccessDefaults()
    const actorType = (() => {
      if (!actor) return 'anonymous' as const
      if (actor.type === 'user' && actor.role === 'ADMIN') return 'admin' as const
      return actor.type
    })()

    const mapped = rows
      .filter((row) => groupMap.has(row.connectionGroupId))
      .map((row) => {
        const group = groupMap.get(row.connectionGroupId)!
        let tags: Array<{ name: string }> = []
        try {
          const parsed = JSON.parse(row.tagsJson || '[]')
          tags = Array.isArray(parsed) ? parsed : []
        } catch {
          tags = []
        }
        const contextWindow = extractContextWindow(row.metaJson)
        const maxOutputTokens = extractMaxOutputTokens(row.metaJson)
        const temperature = extractTemperature(row.metaJson)
        const overrideState = readModelOverrideState(row)
        const storedCaps = this.parseCapabilityEnvelope(row.capabilitiesJson)
        let capabilities = storedCaps?.flags
        let capabilitySource = storedCaps?.source ?? null
        if (!storedCaps || !hasDefinedCapability(capabilities)) {
          const fallback = this.computeCapabilities(row.rawId)
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
          displayName: group.displayName,
          channelName: this.deriveChannelName(group.provider as any, group.baseUrl),
          connectionBaseUrl: group.baseUrl,
          connectionId: group.id,
          modelType: row.modelType || 'chat',
          tags,
          capabilities,
          capabilitySource: capabilitySource || undefined,
          overridden: overrideState.any,
          overrides: {
            capability: overrideState.capabilities,
            parameters: overrideState.parameters,
            access: overrideState.access,
            any: overrideState.any,
          },
          efforts: resolveSupportedEfforts({
            provider: group.provider as ProviderType,
            thinkingDialect: group.thinkingDialect,
            rawModelId: row.rawId,
          }),
          contextWindow,
          maxOutputTokens,
          temperature,
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
    const connectionGroupId = payload.connectionId
    const rawId = (payload.rawId || '').trim()
    if (!connectionGroupId || !rawId) {
      throw new ModelCatalogServiceError('connectionId/rawId required')
    }
    const group = await this.prisma.connectionGroup.findUnique({ where: { id: connectionGroupId } })
    if (!group) {
      throw new ModelCatalogServiceError('Connection not found', 404)
    }
    if (!isSupportedProvider(group.provider)) throw new ModelCatalogServiceError('Unsupported provider')

    const hasCapabilitiesPayload = payload.capabilitiesInput != null
    const capabilityFlags = hasCapabilitiesPayload
      ? this.normalizeCapabilityFlags(payload.capabilitiesInput as Record<string, any> | null | undefined)
      : undefined
    const capabilitiesJson = hasCapabilitiesPayload
      ? this.serializeCapabilityEnvelopeFn({ flags: capabilityFlags || {}, source: 'manual' })
      : undefined
    const ttlSec = Number.parseInt(process.env.MODELS_TTL_S || '120', 10) || 120
    const now = this.now()
    const expiresAt = new Date(now.getTime() + ttlSec * 1000)
    const modelId = (group.prefixId ? `${group.prefixId}.` : '') + rawId

    const existing = await this.prisma.modelCatalog.findFirst({
      where: { connectionGroupId, modelId },
    })
    const metaPayload = parseModelMeta(existing?.metaJson)

    const parameterInput: {
      maxOutputTokens?: number | null
      contextWindow?: number | null
      temperature?: number | null
    } = {}

    if (Object.prototype.hasOwnProperty.call(payload, 'maxOutputTokens')) {
      if (payload.maxOutputTokens == null) {
        parameterInput.maxOutputTokens = null
      } else {
        const value = clampMaxOutputTokens(payload.maxOutputTokens)
        if (value <= 0) {
          throw new ModelCatalogServiceError('max_output_tokens must be positive')
        }
        parameterInput.maxOutputTokens = value
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'contextWindow')) {
      if (payload.contextWindow == null) {
        parameterInput.contextWindow = null
      } else {
        const numeric = Number.parseInt(String(payload.contextWindow), 10)
        if (!Number.isFinite(numeric) || numeric <= 0) {
          throw new ModelCatalogServiceError('context_window must be positive')
        }
        parameterInput.contextWindow = numeric
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'temperature')) {
      if (payload.temperature == null) {
        parameterInput.temperature = null
      } else {
        const numeric = Number.parseFloat(String(payload.temperature))
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 2) {
          throw new ModelCatalogServiceError('temperature must be between 0 and 2')
        }
        parameterInput.temperature = numeric
      }
    }

    // 手写参数只写 custom_* 与 temperature，刷新写入的检测键不受影响。
    const metaWithParameters = setModelParameterOverride(metaPayload, parameterInput)

    if (Object.prototype.hasOwnProperty.call(payload, 'accessPolicyInput')) {
      const normalized = this.normalizeAccessPolicyInput(payload.accessPolicyInput)
      if (normalized) {
        metaWithParameters.access_policy = normalized
      } else {
        delete metaWithParameters.access_policy
      }
    }

    const metaJson = JSON.stringify(metaWithParameters)
    const overrideState = readModelOverrideState({
      capabilitiesJson: capabilitiesJson ?? existing?.capabilitiesJson ?? null,
      metaJson,
      manualOverride: existing?.manualOverride ?? false,
    })

    if (!existing) {
      await this.prisma.modelCatalog.create({
        data: {
          connectionGroupId,
          modelId,
          rawId,
          name: rawId,
          provider: group.provider,
          // 旧列仅为兼容历史 schema 保留；连接类型已无运行时语义。
          connectionType: 'external',
          tagsJson: '[]',
          capabilitiesJson: capabilitiesJson || '{}',
          metaJson,
          manualOverride: overrideState.any,
          lastFetchedAt: now,
          expiresAt,
        },
      })
    } else {
      const updateData: Prisma.ModelCatalogUpdateInput = {
        metaJson,
        manualOverride: overrideState.any,
        lastFetchedAt: now,
        expiresAt,
      }
      if (capabilitiesJson) {
        updateData.capabilitiesJson = capabilitiesJson
      }
      await this.prisma.modelCatalog.update({ where: { id: existing.id }, data: updateData })
    }

    this.invalidateCompletionLimitCache(connectionGroupId, rawId)
    this.invalidateContextWindowCache(connectionGroupId, rawId)
  }

  async deleteOverrides(payload: DeleteOverridesPayload) {
    if (payload.all) {
      const result = await this.prisma.modelCatalog.deleteMany({ where: { manualOverride: true, connectionGroup: { provider: { in: [...SUPPORTED_PROVIDERS] } } } })
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
        fields: this.normalizeOverrideFields(item.fields),
      }))
      .filter((item) => Number.isFinite(item.connectionId) && item.connectionId > 0 && item.rawId)
    if (!normalized.length) {
      throw new ModelCatalogServiceError('items required')
    }

    const connectionGroupIds = Array.from(new Set(normalized.map((item) => item.connectionId)))
    const groups = await this.prisma.connectionGroup.findMany({
      where: { id: { in: connectionGroupIds } },
      select: { id: true, prefixId: true, provider: true },
    })
    if (groups.length !== connectionGroupIds.length) throw new ModelCatalogServiceError('Connection not found', 404)
    if (groups.some((group) => !isSupportedProvider(group.provider))) throw new ModelCatalogServiceError('Unsupported provider')
    const prefixMap = new Map(groups.map((c) => [c.id, c.prefixId]))
    const modelIdOf = (connectionId: number, rawId: string) => {
      const prefix = prefixMap.get(connectionId) || ''
      return prefix ? `${prefix}.${rawId}` : rawId
    }

    let count = 0
    const fullReset = normalized.filter((item) => item.fields.length === 0)
    const scoped = normalized.filter((item) => item.fields.length > 0)

    if (fullReset.length > 0) {
      const filters = fullReset.map((item) => ({
        connectionGroupId: item.connectionId,
        modelId: modelIdOf(item.connectionId, item.rawId),
      }))
      const result = await this.prisma.modelCatalog.deleteMany({
        where: { OR: filters, manualOverride: true },
      })
      count += result.count
    }

    for (const item of scoped) {
      const modelId = modelIdOf(item.connectionId, item.rawId)
      const row = await this.prisma.modelCatalog.findFirst({
        where: { connectionGroupId: item.connectionId, modelId },
      })
      if (!row) continue
      const cleared = clearModelOverrides(row, item.fields)
      await this.prisma.modelCatalog.update({
        where: { id: row.id },
        data: {
          capabilitiesJson: cleared.capabilitiesJson,
          metaJson: cleared.metaJson,
          manualOverride: cleared.state.any,
        },
      })
      this.invalidateCompletionLimitCache(item.connectionId, item.rawId)
      this.invalidateContextWindowCache(item.connectionId, item.rawId)
      count += 1
    }

    for (const id of connectionGroupIds) {
      await this.refreshByGroupId(id)
    }
    return count
  }

  private normalizeOverrideFields(input: unknown): ModelOverrideField[] {
    if (!Array.isArray(input) || input.length === 0) return []
    const fields = input.filter(isOverrideField)
    if (!fields.length) return []
    const unique = Array.from(new Set(fields))
    return unique.length === ALL_OVERRIDE_FIELDS.length ? [] : unique
  }

  async exportOverrides() {
    const rows = await this.prisma.modelCatalog.findMany({
      where: { manualOverride: true, connectionGroup: { provider: { in: [...SUPPORTED_PROVIDERS] } } },
      select: {
        connectionGroupId: true,
        rawId: true,
        modelId: true,
        tagsJson: true,
        capabilitiesJson: true,
        metaJson: true,
      },
    })
    return rows.map((row) => {
      const parsedCaps = this.parseCapabilityEnvelope(row.capabilitiesJson)
      return {
        connectionId: row.connectionGroupId,
        rawId: row.rawId,
        modelId: row.modelId,
        capabilities: parsedCaps?.flags || undefined,
        capabilitySource: parsedCaps?.source || null,
        accessPolicy: parseAccessPolicyFromMeta(row.metaJson) || undefined,
        temperature: extractTemperature(row.metaJson),
        contextWindow: readModelContextWindow(parseModelMeta(row.metaJson)),
        maxOutputTokens: extractMaxOutputTokens(row.metaJson),
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

}
