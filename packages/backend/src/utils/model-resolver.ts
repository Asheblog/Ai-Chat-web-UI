import type { Connection } from '@prisma/client'
import { ModelResolverService } from '../services/catalog/model-resolver-service'
import type { Actor } from '../types'

let currentModelResolverService: ModelResolverService | null = null

const resolveModelResolverService = (): ModelResolverService => {
  if (!currentModelResolverService) {
    currentModelResolverService = new ModelResolverService()
  }
  return currentModelResolverService
}

export const setModelResolverService = (service: ModelResolverService) => {
  currentModelResolverService = service
}

export const getModelResolverService = (): ModelResolverService =>
  resolveModelResolverService()

/**
 * 兼容旧调用：解析 modelId 对应的系统连接与原始模型 ID。
 */
export async function resolveModelIdForUser(
  userId: number,
  modelId: string,
): Promise<{ connection: Connection; rawModelId: string } | null> {
  return resolveModelResolverService().resolveModelIdForUser(userId, modelId)
}

export async function resolveModelForActor(params: { actor: Actor; modelId: string }) {
  return resolveModelResolverService().resolveModelForRequest({
    actor: params.actor,
    userId: params.actor.type === 'user' ? params.actor.id : null,
    modelId: params.modelId,
  })
}
