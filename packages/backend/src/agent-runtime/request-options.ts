import type { RequestedSkillsPayload } from '../modules/skills/types'
import type { Actor } from '../types'

/** Generation inputs, independent of the chat HTTP request schema. */
export interface RequestGenerationOptions {
  contextEnabled?: boolean
  reasoningEnabled?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh'
  skills?: Partial<RequestedSkillsPayload>
  custom_body?: Record<string, unknown>
  custom_headers?: Array<{ name: string; value: string }>
}

/** 请求显式值优先，其次账号偏好，最后兜底 true。 */
export const resolveContextEnabled = (input: {
  payloadContextEnabled?: boolean
  actorContextEnabled?: boolean | null
}): boolean => input.payloadContextEnabled ?? input.actorContextEnabled ?? true

/**
 * 从 Actor 与请求体解析上下文开关。适配只有这一份，避免各调用点各写一遍
 * 「actor.type === 'user' ? actor.contextEnabled : null」，actor 形状变动时漏改。
 */
export const resolveContextEnabledForActor = (params: {
  actor: Actor
  payloadContextEnabled?: boolean
}): boolean =>
  resolveContextEnabled({
    payloadContextEnabled: params.payloadContextEnabled,
    actorContextEnabled: params.actor.type === 'user' ? params.actor.contextEnabled ?? null : null,
  })
