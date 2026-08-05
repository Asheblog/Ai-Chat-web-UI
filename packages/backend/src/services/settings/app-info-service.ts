import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'

export interface AppInfoServiceDeps {
  prisma?: PrismaClient
  version?: string
}

export class AppInfoService {
  private prisma: PrismaClient
  private version: string

  constructor(deps: AppInfoServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.version = deps.version ?? process.env.APP_VERSION ?? '2026-08-05 14:22 · a283de0'
  }

  async getAppInfo() {
    const registrationSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'registration_enabled' },
    })
    const registrationEnabled = registrationSetting?.value !== 'false'

    return {
      name: 'AI Chat Platform',
      version: this.version,
      mode: registrationEnabled ? 'multi' : 'restricted',
      features: {
        registration: registrationEnabled,
        streaming: true,
        file_upload: false,
        long_term_memory: false,
      },
    }
  }
}
