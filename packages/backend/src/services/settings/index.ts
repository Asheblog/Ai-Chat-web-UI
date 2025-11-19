import { prisma } from '../../db'
import {
  getQuotaPolicy,
  invalidateQuotaPolicyCache,
  invalidateReasoningMaxOutputTokensDefaultCache,
} from '../../utils/system-settings'
import { invalidateTaskTraceConfig } from '../../utils/task-trace'
import { syncSharedAnonymousQuota } from '../../utils/quota'
import { replaceProfileImage } from '../../utils/profile-images'
import { SettingsService } from './settings-service'

export const settingsService = new SettingsService({
  prisma,
  getQuotaPolicy,
  invalidateQuotaPolicyCache,
  invalidateReasoningMaxOutputTokensDefaultCache,
  invalidateTaskTraceConfig,
  syncSharedAnonymousQuota,
  replaceProfileImage,
})

export * from './settings-service'
