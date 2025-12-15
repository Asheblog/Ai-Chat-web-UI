/**
 * Anonymous Cleanup Utils - 代理层
 *
 * 委托给 AnonymousCleanupService，无回退实现。
 */

import { getAnonymousCleanupService } from '../container/service-accessor'
import type { CleanupOptions } from '../services/cleanup/anonymous-cleanup-service'

// Re-export types
export type { CleanupOptions }

export const cleanupAnonymousSessions = (options: CleanupOptions = {}): Promise<void> =>
  getAnonymousCleanupService().cleanup(options)
