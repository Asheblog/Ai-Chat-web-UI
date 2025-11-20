import type { Actor } from '../../types'
import { settingsService, SettingsServiceError } from './settings-service'
import { personalSettingsService } from './personal-settings-service'
import { healthService, HealthServiceError } from './health-service'
import { appInfoService } from './app-info-service'
import {
  syncSharedAnonymousQuota as defaultSyncSharedAnonymousQuota,
} from '../../utils/quota'
import { invalidateQuotaPolicyCache as defaultInvalidateQuotaPolicyCache } from '../../utils/system-settings'

export interface SettingsFacadeDeps {
  settingsService?: typeof settingsService
  personalSettingsService?: typeof personalSettingsService
  healthService?: typeof healthService
  appInfoService?: typeof appInfoService
  syncSharedAnonymousQuota?: typeof defaultSyncSharedAnonymousQuota
  invalidateQuotaPolicyCache?: typeof defaultInvalidateQuotaPolicyCache
}

export class SettingsFacade {
  private settingsService: typeof settingsService
  private personalSettingsService: typeof personalSettingsService
  private healthService: typeof healthService
  private appInfoService: typeof appInfoService
  private syncSharedAnonymousQuota: typeof defaultSyncSharedAnonymousQuota
  private invalidateQuotaPolicyCache: typeof defaultInvalidateQuotaPolicyCache

  constructor(deps: SettingsFacadeDeps = {}) {
    this.settingsService = deps.settingsService ?? settingsService
    this.personalSettingsService = deps.personalSettingsService ?? personalSettingsService
    this.healthService = deps.healthService ?? healthService
    this.appInfoService = deps.appInfoService ?? appInfoService
    this.syncSharedAnonymousQuota = deps.syncSharedAnonymousQuota ?? defaultSyncSharedAnonymousQuota
    this.invalidateQuotaPolicyCache = deps.invalidateQuotaPolicyCache ?? defaultInvalidateQuotaPolicyCache
  }

  async getBrandingText() {
    return this.settingsService.getBrandingText()
  }

  async getSystemSettings(actor: Actor) {
    return this.settingsService.getSystemSettings(actor)
  }

  async updateSystemSettings(payload: Record<string, any>) {
    return this.settingsService.updateSystemSettings(payload)
  }

  async resetAnonymousQuota(options: { resetUsed?: boolean }) {
    await this.syncSharedAnonymousQuota({ resetUsed: Boolean(options.resetUsed) })
    this.invalidateQuotaPolicyCache()
    return { success: true }
  }

  async getPersonalSettings(params: { userId: number; request: Request }) {
    return this.personalSettingsService.getPersonalSettings(params)
  }

  async updatePersonalSettings(params: { userId: number; payload: Record<string, any>; request: Request }) {
    return this.personalSettingsService.updatePersonalSettings(params)
  }

  async getAppInfo() {
    return this.appInfoService.getAppInfo()
  }

  async checkHealth() {
    return this.healthService.check()
  }
}

export { SettingsServiceError, HealthServiceError }

export const settingsFacade = new SettingsFacade()
