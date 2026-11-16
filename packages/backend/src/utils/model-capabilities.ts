import type { PrismaClient } from '@prisma/client'
import { computeCapabilities } from './providers'
import { parseCapabilityEnvelope, type CapabilityFlags } from './capabilities'

/**
 * 解析会话主模型的视觉/生图能力：优先取 ModelCatalog.capabilitiesJson（目录刷新已合并供应商声明与启发式，
 * 人工覆写位于最高层），缺失时按模型 ID 启发式兜底。连接标签不参与能力判定。
 */
export async function resolveModelCapabilitiesForSession(
  prisma: PrismaClient,
  session: { connectionId?: number | null; modelRawId?: string | null },
): Promise<CapabilityFlags> {
  const connectionId = session.connectionId ?? null
  const rawModelId = session.modelRawId || ''
  if (!connectionId || !rawModelId) {
    return computeCapabilities(rawModelId)
  }
  try {
    const catalog = await prisma.modelCatalog.findFirst({
      where: { connectionGroupId: connectionId, rawId: rawModelId },
      select: { capabilitiesJson: true },
    })
    const parsed = parseCapabilityEnvelope(catalog?.capabilitiesJson)
    if (parsed?.flags) {
      return parsed.flags
    }
    return computeCapabilities(rawModelId)
  } catch {
    return computeCapabilities(rawModelId)
  }
}
