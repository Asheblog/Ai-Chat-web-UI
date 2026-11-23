/**
 * web_search 的结构化请求参数（可选）：
 * - domains：新闻/指定来源的站点收窄，与部署白名单取交集，不放宽白名单；
 * - time_range：发布时间窗，倒置或无法解析一律显式 invalid_request，不悄悄反转；
 * - include_images：显式请求二进制网页配图，默认关闭。
 *
 * 不带这些参数时请求形状与既有调用完全一致。
 */

import {
  normalizeSearchDomainHost,
  normalizeTimeRangeDate,
  type WebSearchTimeRange,
} from '../../../utils/web-search'
import type { RetrievalRestriction } from './web-search-outcome'

const MAX_REQUESTED_DOMAINS = 8

/** 可用的主机名：至少一个点，纯 ASCII 标签或 punycode，不含空格/路径/端口。 */
const HOSTNAME_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/

/**
 * 归一请求来源。区分「没提供 / 空数组」与「提供了但全是垃圾」：
 * 前者视为未限定，后者必须报 invalid_request，不能静默降级成全网。
 */
const normalizeRequestedDomains = (
  value: unknown,
): { raw: string[]; hosts: string[]; rejected: string[] } => {
  const raw = toDomainCandidates(value)
    .map((item) => item.trim())
    .filter(Boolean)
  const hosts: string[] = []
  const rejected: string[] = []
  for (const item of raw) {
    const host = normalizeSearchDomainHost(item)
    if (host && HOSTNAME_RE.test(host)) {
      if (!hosts.includes(host)) hosts.push(host)
    } else {
      rejected.push(item)
    }
  }
  return { raw, hosts: hosts.slice(0, MAX_REQUESTED_DOMAINS), rejected }
}

/**
 * 请求来源与部署白名单的交集。
 * - 父域请求 + 子域白名单：取白名单子域；
 * - 子域请求 + 父域白名单：取请求子域；
 * - 任一方为空表示未限定。
 * 部署白名单仍是硬边界，交集不会超出两侧更具体的范围。
 */
const intersectDomains = (requested: string[], whitelist: string[]): string[] => {
  if (whitelist.length === 0) return requested
  if (requested.length === 0) return whitelist
  const effective: string[] = []
  for (const host of requested) {
    for (const allowed of whitelist) {
      const hostWithinAllowed = host === allowed || host.endsWith(`.${allowed}`)
      const allowedWithinHost = allowed === host || allowed.endsWith(`.${host}`)
      if (!hostWithinAllowed && !allowedWithinHost) continue
      const pick = hostWithinAllowed ? host : allowed
      if (!effective.includes(pick)) effective.push(pick)
    }
  }
  return effective
}

export interface WebSearchRequestPlan {
  includeImages: boolean
  timeRange?: WebSearchTimeRange
  restriction: RetrievalRestriction
  /** 请求来源与部署白名单没有交集：不能在不放宽白名单的前提下检索。 */
  conflict: boolean
}

export type WebSearchRequestParseResult =
  | { ok: true; plan: WebSearchRequestPlan }
  | { ok: false; errorCode: 'INVALID_REQUEST'; message: string }

const toDomainCandidates = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string') return value.split(/[,\n]/)
  return []
}

const invalid = (message: string): WebSearchRequestParseResult => ({
  ok: false,
  errorCode: 'INVALID_REQUEST',
  message,
})

const isDateProvided = (value: unknown): boolean =>
  value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')

export const parseWebSearchRequestArgs = (input: {
  args: Record<string, unknown>
  configDomains?: string[]
}): WebSearchRequestParseResult => {
  const requestedDomains = normalizeRequestedDomains(input.args.domains)
  if (requestedDomains.raw.length > 0 && requestedDomains.hosts.length === 0) {
    const sample = requestedDomains.rejected.slice(0, 3).join(', ')
    return invalid(
      `domains must be valid host names; none of the provided values could be used${sample ? ` (${sample})` : ''}`,
    )
  }
  const requested = requestedDomains.hosts
  const whitelist = Array.from(
    new Set((input.configDomains || []).map((item) => normalizeSearchDomainHost(item)).filter(Boolean)),
  )
  // 部署白名单是硬边界：请求来源只能在其内收窄，不能替代或放宽它
  const effective = intersectDomains(requested, whitelist)
  const conflict = whitelist.length > 0 && requested.length > 0 && effective.length === 0

  let timeRange: WebSearchTimeRange | undefined
  const rawTimeRange = input.args.time_range
  if (rawTimeRange !== undefined && rawTimeRange !== null) {
    if (typeof rawTimeRange !== 'object' || Array.isArray(rawTimeRange)) {
      return invalid('time_range must be an object with optional start and end dates (YYYY-MM-DD)')
    }
    const record = rawTimeRange as Record<string, unknown>
    const startProvided = isDateProvided(record.start)
    const endProvided = isDateProvided(record.end)
    const start = startProvided ? normalizeTimeRangeDate(record.start) : null
    const end = endProvided ? normalizeTimeRangeDate(record.end) : null
    if (startProvided && !start) {
      return invalid('time_range.start must be a valid date in YYYY-MM-DD')
    }
    if (endProvided && !end) {
      return invalid('time_range.end must be a valid date in YYYY-MM-DD')
    }
    if (start && end && start > end) {
      return invalid('time_range.start must not be after time_range.end')
    }
    if (start || end) {
      timeRange = {
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
      }
    }
  }

  const includeImages = input.args.include_images === true || input.args.include_images === 'true'

  return {
    ok: true,
    plan: {
      includeImages,
      ...(timeRange ? { timeRange } : {}),
      conflict,
      restriction: {
        restricted: requested.length > 0 || whitelist.length > 0,
        requested,
        effective,
      },
    },
  }
}
