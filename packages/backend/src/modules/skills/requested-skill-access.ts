import type { PrismaClient } from '@prisma/client'
import type { Actor } from '../../types'
import { normalizeRequestedSkills, type RequestedSkillReference, type RequestedSkillsPayload } from './types'

export class RequestedSkillAccessError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 403) {
    super(message)
    this.name = 'RequestedSkillAccessError'
    this.statusCode = statusCode
  }
}

export interface ResolveRequestedSkillAccessInput {
  prisma: PrismaClient
  actor: Actor
  sessionId: number
  payload: unknown
}

const keyForRef = (ref: RequestedSkillReference) => `${ref.skillId}:${ref.versionId}`

export async function resolveRequestedSkillAccess(
  input: ResolveRequestedSkillAccessInput,
): Promise<RequestedSkillsPayload> {
  const requested = normalizeRequestedSkills(input.payload)
  if (requested.enabled.length === 0) {
    return requested
  }

  if (input.actor.type !== 'user') {
    throw new RequestedSkillAccessError('匿名用户不能启用第三方 Skill', 401)
  }

  const skillIds = Array.from(new Set(requested.enabled.map((item) => item.skillId)))
  const versionIds = Array.from(new Set(requested.enabled.map((item) => item.versionId)))
  const [skills, versions, bindings] = await Promise.all([
    (input.prisma as any).skill.findMany({
      where: {
        id: { in: skillIds },
        status: 'active',
        OR: [
          { visibility: 'system' },
          { ownerUserId: input.actor.id },
        ],
      },
      select: {
        id: true,
        ownerUserId: true,
        visibility: true,
      },
    }),
    (input.prisma as any).skillVersion.findMany({
      where: {
        id: { in: versionIds },
        skillId: { in: skillIds },
        status: 'active',
      },
      select: {
        id: true,
        skillId: true,
      },
    }),
    (input.prisma as any).skillBinding.findMany({
      where: {
        skillId: { in: skillIds },
        versionId: { in: versionIds },
        scopeType: 'session',
        scopeId: String(input.sessionId),
        sessionId: input.sessionId,
        enabled: true,
        createdByUserId: input.actor.id,
      },
      select: {
        skillId: true,
        versionId: true,
      },
    }),
  ])

  const visibleSkillIds = new Set(skills.map((skill: any) => skill.id))
  const versionByKey = new Set(versions.map((version: any) => `${version.skillId}:${version.id}`))
  const bindingKeys = new Set(bindings.map((binding: any) => `${binding.skillId}:${binding.versionId}`))
  const allowed: RequestedSkillReference[] = []

  for (const ref of requested.enabled) {
    const refKey = keyForRef(ref)
    if (!visibleSkillIds.has(ref.skillId)) {
      throw new RequestedSkillAccessError(`Skill 不可见或不存在：${ref.skillId}`, 404)
    }
    if (!versionByKey.has(refKey)) {
      throw new RequestedSkillAccessError(`Skill 版本不可用：${ref.skillId}/${ref.versionId}`, 404)
    }
    if (!bindingKeys.has(refKey)) {
      throw new RequestedSkillAccessError(`Skill 未在当前会话启用：${ref.skillId}`, 403)
    }
    allowed.push(ref)
  }

  return {
    ...requested,
    enabled: allowed,
  }
}
