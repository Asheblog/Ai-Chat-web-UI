import type { Connection } from '@prisma/client'
import { modelResolverService } from '../services/catalog/model-resolver-service'

/**
 * 兼容旧调用：解析 modelId 对应的系统连接与原始模型 ID。
 */
export async function resolveModelIdForUser(
  userId: number,
  modelId: string,
): Promise<{ connection: Connection; rawModelId: string } | null> {
  return modelResolverService.resolveModelIdForUser(userId, modelId)
}
