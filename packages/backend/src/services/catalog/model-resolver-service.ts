import type { PrismaClient } from '@prisma/client'
import type { Connection } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  PrismaModelResolverRepository,
  type ModelResolverRepository,
} from '../../repositories/model-resolver-repository'
import type { Actor } from '../../types'
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
   * 解析 modelId 对应的系统连接与原始模型 ID。
   * 顺序：model_catalog 缓存 → prefix 规则 → 连接模型显式列表 → 第一个启用连接。
   */
  async resolveModelIdForUser(
    userId: number,
    modelId: string,
  ): Promise<{ connection: Connection; rawModelId: string; metaJson?: string | null } | null> {
    const cleanModelId = (modelId || '').trim()
    if (!cleanModelId) return null
    // 用户ID目前未用于筛选，但保留以便后续权限/私有连接扩展
    void userId

    const cached = await this.repository.findCachedModel(cleanModelId)

    if (cached?.connection && cached.rawId) {
      return {
        connection: cached.connection,
        rawModelId: cached.rawId,
        metaJson: cached.metaJson,
      }
    }

    const connections = await this.repository.listEnabledSystemConnections()

    let fallbackExact: { connection: Connection; rawId: string } | null = null
    let fallbackFirst: { connection: Connection; rawId: string } | null = null

    for (const conn of connections) {
      const prefix = (conn.prefixId || '').trim()
      if (prefix && cleanModelId.startsWith(`${prefix}.`)) {
        const rawId = cleanModelId.slice(prefix.length + 1)
        return { connection: conn, rawModelId: rawId }
      }

      if (!prefix) {
        if (!fallbackFirst) {
          fallbackFirst = { connection: conn, rawId: cleanModelId }
        }

        if (!fallbackExact) {
          const ids = parseModelIds(conn.modelIdsJson)
          if (ids.includes(cleanModelId)) {
            fallbackExact = { connection: conn, rawId: cleanModelId }
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
    connectionId?: number
    rawId?: string
  }): Promise<{ connection: Connection; rawModelId: string } | null> {
    const userId = params.userId ?? 0
    const modelId = (params.modelId || '').trim()

    const actorType = (() => {
      if (params.actor?.type === 'user' && params.actor.role === 'ADMIN') return 'admin' as const
      if (params.actor) return params.actor.type
      return userId ? 'user' : 'anonymous'
    })()

    const defaults: ModelAccessDefaults | null = actorType === 'admin' ? null : await this.getModelAccessDefaults()
    const isAllowed = (metaJson?: string | null) => {
      if (actorType === 'admin') return true
      const access = this.resolveModelAccessPolicy({ metaJson, defaults: defaults! })
      return decideModelAccessForActor(params.actor ?? { type: actorType }, access.resolved) === 'allow'
    }

    if (params.connectionId && params.rawId) {
      const connection = await this.repository.findEnabledSystemConnectionById(params.connectionId)
      if (!connection) {
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

let modelResolverService = new ModelResolverService()

export const setModelResolverServiceInstance = (service: ModelResolverService) => {
  modelResolverService = service
}

export { modelResolverService }
