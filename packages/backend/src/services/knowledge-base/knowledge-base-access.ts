/**
 * 知识库功能与角色策略：唯一判定点。
 *
 * 三个设置项（`knowledgeBaseEnabled` / `knowledgeBaseAllowAnonymous` / `knowledgeBaseAllowUsers`）
 * 过去只在前端过滤选择器，服务端没有任何校验；本模块把它们收成一个纯判定，
 * 用户消费面（列表、详情、检索、聊天内知识库工具）都必须经过它。
 *
 * 边界：
 * - `enabled` 是功能总闸，对所有人（含管理员）生效——关闭后管理面 `/admin` 与写操作仍可达，
 *   但任何"像用户一样读知识库"的入口都不再返回内容。
 * - 角色开关只作用于身份；管理员绕过角色开关，不绕过功能总闸。
 */

import type { Actor } from '../../types'
import { parseBooleanSetting } from '../../utils/parsers'

export interface KnowledgeBasePolicy {
  enabled: boolean
  allowAnonymous: boolean
  allowUsers: boolean
}

export type KnowledgeBaseAccessReason =
  | 'feature_disabled'
  | 'anonymous_denied'
  | 'user_denied'

export interface KnowledgeBaseAccessDecision {
  allowed: boolean
  reason?: KnowledgeBaseAccessReason
}

export interface KnowledgeBaseActorContext {
  isAnonymous: boolean
  isAdmin: boolean
}

/** 设置键：策略读取与设置页字段共用同一组存储键。 */
export const KNOWLEDGE_BASE_POLICY_KEYS = [
  'knowledge_base_enabled',
  'knowledge_base_allow_anonymous',
  'knowledge_base_allow_users',
] as const

/** 未配置时的默认值与设置页一致：关闭、不允许匿名、允许注册用户。 */
export const DEFAULT_KNOWLEDGE_BASE_POLICY: KnowledgeBasePolicy = {
  enabled: false,
  allowAnonymous: false,
  allowUsers: true,
}

const ACCESS_ERROR_MESSAGES: Record<KnowledgeBaseAccessReason, string> = {
  feature_disabled: '知识库功能未开启',
  anonymous_denied: '匿名用户不可使用知识库',
  user_denied: '注册用户不可使用知识库',
}

/**
 * 从系统设置行（已解码为字符串）解析策略。
 *
 * 布尔解析走项目统一的 `parseBooleanSetting`（true/false、1/0、yes/no、y/n、on/off），
 * 与运行时配置构建器同一套语义；未识别的值回落默认，不在这里自造第二套解析。
 */
export function knowledgeBasePolicyFromSettings(
  settings: Record<string, string | null | undefined>,
): KnowledgeBasePolicy {
  return {
    enabled: parseBooleanSetting(
      settings.knowledge_base_enabled,
      DEFAULT_KNOWLEDGE_BASE_POLICY.enabled,
    ),
    allowAnonymous: parseBooleanSetting(
      settings.knowledge_base_allow_anonymous,
      DEFAULT_KNOWLEDGE_BASE_POLICY.allowAnonymous,
    ),
    allowUsers: parseBooleanSetting(
      settings.knowledge_base_allow_users,
      DEFAULT_KNOWLEDGE_BASE_POLICY.allowUsers,
    ),
  }
}

/** 把鉴权层的 actor 归一成策略需要的两个事实。 */
export function knowledgeBaseActorContext(actor: Actor): KnowledgeBaseActorContext {
  return {
    isAnonymous: actor.type !== 'user',
    isAdmin: actor.type === 'user' && actor.role === 'ADMIN',
  }
}

export function evaluateKnowledgeBaseAccess(
  policy: KnowledgeBasePolicy,
  actor: KnowledgeBaseActorContext,
): KnowledgeBaseAccessDecision {
  if (!policy.enabled) return { allowed: false, reason: 'feature_disabled' }
  if (actor.isAdmin) return { allowed: true }
  if (actor.isAnonymous) {
    return policy.allowAnonymous ? { allowed: true } : { allowed: false, reason: 'anonymous_denied' }
  }
  return policy.allowUsers ? { allowed: true } : { allowed: false, reason: 'user_denied' }
}

export function knowledgeBaseAccessErrorMessage(reason?: KnowledgeBaseAccessReason): string {
  return ACCESS_ERROR_MESSAGES[reason ?? 'feature_disabled']
}
