import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  PrismaModelResolverRepository,
  type ModelResolverRepository,
  type ResolvedConnection,
} from '../../repositories/model-resolver-repository'
import type { Actor } from '../../types'
import { isSupportedProvider } from '../../utils/providers'
import {
  decideModelAccessForActor,
  getModelAccessDefaults as defaultGetModelAccessDefaults,
  resolveModelAccessPolicy as defaultResolveModelAccessPolicy,
  type ModelAccessDefaults,
} from '../../utils/model-access-policy'

const parseModelIds = (json?: string | null): string[] => {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

export interface ModelResolverDeps {
  prisma?: PrismaClient
  repository?: ModelResolverRepository
  getModelAccessDefaults?: () => Promise<ModelAccessDefaults>
  resolveModelAccessPolicy?: typeof defaultResolveModelAccessPolicy
}

export class ModelResolverService {
  private repository: ModelResolverRepository
  private getModelAccessDefaults: () => Promise<ModelAccessDefaults>
  private resolveModelAccessPolicy: typeof defaultResolveModelAccessPolicy

  constructor(deps: ModelResolverDeps = {}) {
    const prisma = deps.prisma ?? defaultPrisma
    this.repository = deps.repository ?? new PrismaModelResolverRepository(prisma)
    this.getModelAccessDefaults = deps.getModelAccessDefaults ?? defaultGetModelAccessDefaults
    this.resolveModelAccessPolicy = deps.resolveModelAccessPolicy ?? defaultResolveModelAccessPolicy
  }

  /**
   * 解析 modelId 对应的系统连接组与原始模型 ID。
   * 顺序：model_catalog 缓存 → prefix 规则 → 凭据模型显式列表 → 第一个启用组。
   */
  async resolveModelIdForUser(
    userId: number,
    modelId: string,
  ): Promise<{ connection: ResolvedConnection; rawModelId: string; metaJson?: string | null } | null> {
    const cleanModelId = (modelId || '').trim()
    if (!cleanModelId) return null
    void userId

    const cached = await this.repository.findCachedModel(cleanModelId)

    if (cached?.connection && cached.rawId) {
      if (!isSupportedProvider(cached.connection.provider)) return null
      return {
        connection: cached.connection,
        rawModelId: cached.rawId,
        metaJson: cached.metaJson,
      }
    }

    const groups = await this.repository.listSystemGroupsForResolution()

    // Retired prefixed identities must never fall through to another connection.
    const retiredPrefixMatch = groups.some((group) => {
      const prefix = (group.prefixId || '').trim()
      return !isSupportedProvider(group.provider) && prefix && cleanModelId.startsWith(`${prefix}.`)
    })
    if (retiredPrefixMatch) return null

    let fallbackExact: { connection: ResolvedConnection; rawId: string } | null = null
    let fallbackFirst: { connection: ResolvedConnection; rawId: string } | null = null

    for (const group of groups) {
      if (!group.enable || !isSupportedProvider(group.provider)) continue
      const enabledCredentials = group.credentials.filter((item) => item.enable)
      const credentials = enabledCredentials.length > 0 ? enabledCredentials : group.credentials
      if (credentials.length === 0) continue

      const primary = credentials[0]!
      const resolved = {
        ...group,
        credentialId: primary.id,
        secretVaultId: primary.secretVaultId,
        modelIdsJson: primary.modelIdsJson,
        apiKeyLabel: primary.apiKeyLabel,
      } satisfies ResolvedConnection

      const prefix = (group.prefixId || '').trim()
      if (prefix && cleanModelId.startsWith(`${prefix}.`)) {
        const rawId = cleanModelId.slice(prefix.length + 1)
        return { connection: resolved, rawModelId: rawId }
      }

      if (!prefix) {
        if (!fallbackFirst) {
          fallbackFirst = { connection: resolved, rawId: cleanModelId }
        }

        if (!fallbackExact) {
          for (const credential of credentials) {
            const ids = parseModelIds(credential.modelIdsJson)
            if (ids.includes(cleanModelId)) {
              fallbackExact = {
                connection: {
                  ...group,
                  credentialId: credential.id,
                  secretVaultId: credential.secretVaultId,
                  modelIdsJson: credential.modelIdsJson,
                  apiKeyLabel: credential.apiKeyLabel,
                },
                rawId: cleanModelId,
              }
              break
            }
          }
        }
      }
    }

    if (fallbackExact) {
      return {
        connection: fallbackExact.connection,
        rawModelId: fallbackExact.rawId || cleanModelId,
      }
    }
    if (fallbackFirst) {
      return {
        connection: fallbackFirst.connection,
        rawModelId: fallbackFirst.rawId || cleanModelId,
      }
    }
    return null
  }

  async resolveModelForRequest(params: {
    actor?: Actor
    userId?: number | null
    modelId: string
    /** Group id or legacy credential id (dual-read). */
    connectionId?: number
    rawId?: string
  }): Promise<{ connection: ResolvedConnection; rawModelId: string } | null> {
    const userId = params.userId ?? 0
    const modelId = (params.modelId || '').trim()

    const actorType = (() => {
      if (params.actor?.type === 'user' && params.actor.role === 'ADMIN') return 'admin' as const
      if (params.actor) return params.actor.type
      return userId ? 'user' : 'anonymous'
    })()

    const defaults: ModelAccessDefaults | null =
      actorType === 'admin' ? null : await this.getModelAccessDefaults()
    const isAllowed = (metaJson?: string | null) => {
      if (actorType === 'admin') return true
      const access = this.resolveModelAccessPolicy({ metaJson, defaults: defaults! })
      return decideModelAccessForActor(params.actor ?? { type: actorType }, access.resolved) === 'allow'
    }

    if (params.connectionId && params.rawId) {
      const connection = await this.repository.findEnabledResolvedConnectionById(params.connectionId)
      if (!connection || !isSupportedProvider(connection.provider)) {
        return null
      }
      const modelIdWithPrefix = (connection.prefixId ? `${connection.prefixId}.` : '') + params.rawId
      const cached = await this.repository.findCachedModel(modelIdWithPrefix)
      if (!isAllowed(cached?.metaJson)) {
        return null
      }
      return {
        connection,
        rawModelId: params.rawId,
      }
    }

    if (!modelId) return null

    const resolved = await this.resolveModelIdForUser(userId, modelId)
    if (!resolved) return null

    if (!isAllowed(resolved.metaJson)) {
      return null
    }

    return { connection: resolved.connection, rawModelId: resolved.rawModelId }
  }
}
