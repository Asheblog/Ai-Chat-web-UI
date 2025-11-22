import type { Connection } from '@prisma/client'
import {
  modelResolverService as defaultModelResolverService,
  ModelResolverService,
} from '../services/catalog/model-resolver-service'
import type { Actor } from '../types'

let currentModelResolverService: ModelResolverService = defaultModelResolverService

export const setModelResolverService = (service: ModelResolverService) => {
  currentModelResolverService = service
}

export const getModelResolverService = (): ModelResolverService => currentModelResolverService

/**
 * 兼容旧调用：解析 modelId 对应的系统连接与原始模型 ID。
 */
export async function resolveModelIdForUser(
  userId: number,
  modelId: string,
): Promise<{ connection: Connection; rawModelId: string } | null> {
  return currentModelResolverService.resolveModelIdForUser(userId, modelId)
}

export async function resolveModelForActor(params: { actor: Actor; modelId: string }) {
  return currentModelResolverService.resolveModelForRequest({
    actor: params.actor,
    userId: params.actor.type === 'user' ? params.actor.id : null,
    modelId: params.modelId,
  })
}
