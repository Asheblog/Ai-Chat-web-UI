import type { PrismaClient } from '@prisma/client'
import type { Connection } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  PrismaModelResolverRepository,
  type ModelResolverRepository,
} from '../../repositories/model-resolver-repository'

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
}

export class ModelResolverService {
  private repository: ModelResolverRepository

  constructor(deps: ModelResolverDeps = {}) {
    const prisma = deps.prisma ?? defaultPrisma
    this.repository = deps.repository ?? new PrismaModelResolverRepository(prisma)
  }

  /**
   * 解析 modelId 对应的系统连接与原始模型 ID。
   * 顺序：model_catalog 缓存 → prefix 规则 → 连接模型显式列表 → 第一个启用连接。
   */
  async resolveModelIdForUser(
    userId: number,
    modelId: string,
  ): Promise<{ connection: Connection; rawModelId: string } | null> {
    const cleanModelId = (modelId || '').trim()
    if (!cleanModelId) return null
    // 用户ID目前未用于筛选，但保留以便后续权限/私有连接扩展
    void userId

    const cached = await this.repository.findCachedModel(cleanModelId)

    if (cached?.connection && cached.rawId) {
      return {
        connection: cached.connection,
        rawModelId: cached.rawId,
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
}

export const modelResolverService = new ModelResolverService()
