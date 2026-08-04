import type { PrismaClient } from '@prisma/client'
import { computeCapabilities } from './providers'
import { parseCapabilityEnvelope, type CapabilityFlags } from './capabilities'

/**
 * 解析会话主模型的视觉/生图能力：优先取 ModelCatalog.capabilitiesJson，
 * 缺失时按模型 ID/标签启发式判定（与 agent 流 resolveModelCapabilities 同逻辑）。
 */
export async function resolveModelCapabilitiesForSession(
  prisma: PrismaClient,
  session: { connectionId?: number | null; modelRawId?: string | null },
): Promise<CapabilityFlags> {
  const connectionId = session.connectionId ?? null
  const rawModelId = session.modelRawId || ''
  if (!connectionId || !rawModelId) {
    return computeCapabilities(rawModelId, [])
  }
  try {
    const catalog = await prisma.modelCatalog.findFirst({
      where: { connectionId, rawId: rawModelId },
      select: { capabilitiesJson: true, tagsJson: true },
    })
    const parsed = parseCapabilityEnvelope(catalog?.capabilitiesJson)
    if (parsed?.flags) {
      return parsed.flags
    }
    const tags = (() => {
      try {
        const value = JSON.parse(catalog?.tagsJson || '[]')
        return Array.isArray(value) ? value : []
      } catch {
        return []
      }
    })()
    return computeCapabilities(rawModelId, tags)
  } catch {
    return computeCapabilities(rawModelId, [])
  }
}
