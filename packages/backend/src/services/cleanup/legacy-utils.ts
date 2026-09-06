/**
 * Anonymous Cleanup 兼容代理层。
 *
 * 从 utils/anonymous-cleanup.ts 迁移至 services 层，避免 utils 依赖 services。
 */

import type { CleanupOptions } from './anonymous-cleanup-service'
import type { AnonymousCleanupService } from './anonymous-cleanup-service'

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
