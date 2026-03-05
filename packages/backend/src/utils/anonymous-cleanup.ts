/**
 * Anonymous Cleanup Utils - 代理层
 *
 * 委托给 AnonymousCleanupService，可由容器显式绑定。
 */

import type { CleanupOptions } from '../services/cleanup/anonymous-cleanup-service'
import type { AnonymousCleanupService } from '../services/cleanup/anonymous-cleanup-service'

// Re-export types
export type { CleanupOptions }

type AnonymousCleanupServiceLike = Pick<AnonymousCleanupService, 'cleanup'>

interface AnonymousCleanupUtilsDeps {
  anonymousCleanupService: AnonymousCleanupServiceLike
}

let configuredAnonymousCleanupService: AnonymousCleanupServiceLike | null = null

const resolveAnonymousCleanupService = (): AnonymousCleanupServiceLike => {
  if (configuredAnonymousCleanupService) return configuredAnonymousCleanupService
  throw new Error('[anonymous-cleanup] AnonymousCleanupService 未配置')
}

export const configureAnonymousCleanupUtils = (deps: AnonymousCleanupUtilsDeps): void => {
  configuredAnonymousCleanupService = deps.anonymousCleanupService
}

export const cleanupAnonymousSessions = (options: CleanupOptions = {}): Promise<void> =>
  resolveAnonymousCleanupService().cleanup(options)
