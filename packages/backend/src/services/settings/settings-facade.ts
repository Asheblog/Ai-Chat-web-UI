import type { Actor } from '../../types'
import {
  SettingsService,
  SettingsServiceError,
  type SetupState,
} from './settings-service'
import { PersonalSettingsService } from './personal-settings-service'
import { HealthService, HealthServiceError } from './health-service'
import { AppInfoService } from './app-info-service'
import {
  syncSharedAnonymousQuota as defaultSyncSharedAnonymousQuota,
} from '../../utils/quota'
import { invalidateQuotaPolicyCache as defaultInvalidateQuotaPolicyCache } from '../../utils/system-settings'

export interface SettingsFacadeDeps {
  settingsService: SettingsService
  personalSettingsService: PersonalSettingsService
  healthService: HealthService
  appInfoService: AppInfoService
  syncSharedAnonymousQuota?: typeof defaultSyncSharedAnonymousQuota
  invalidateQuotaPolicyCache?: typeof defaultInvalidateQuotaPolicyCache
}

export class SettingsFacade {
  private settingsService: SettingsService
  private personalSettingsService: PersonalSettingsService
  private healthService: HealthService
  private appInfoService: AppInfoService
  private syncSharedAnonymousQuota: typeof defaultSyncSharedAnonymousQuota
  private invalidateQuotaPolicyCache: typeof defaultInvalidateQuotaPolicyCache

  constructor(deps: SettingsFacadeDeps) {
    this.settingsService = deps.settingsService
    this.personalSettingsService = deps.personalSettingsService
    this.healthService = deps.healthService
    this.appInfoService = deps.appInfoService
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

  async getSetupStatus(actor?: Actor | null) {
    return this.settingsService.getSetupStatus(actor)
  }

  async setSetupState(state: SetupState) {
    return this.settingsService.setSetupState(state)
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
