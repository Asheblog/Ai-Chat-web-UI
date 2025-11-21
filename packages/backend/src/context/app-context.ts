import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db'
import { getAppConfig, type AppConfig } from '../config/app-config'

export interface AppContext {
  config: AppConfig
  prisma: PrismaClient
  fetchImpl: typeof fetch
  logger: Pick<typeof console, 'info' | 'warn' | 'error' | 'debug' | 'log'>
}

export const createAppContext = (overrides: Partial<AppContext> = {}): AppContext => {
  const config = overrides.config ?? getAppConfig()
  return {
    config,
    prisma: overrides.prisma ?? defaultPrisma,
    fetchImpl: overrides.fetchImpl ?? fetch,
    logger: overrides.logger ?? console,
  }
}

const defaultContext = createAppContext()

export const getAppContext = () => defaultContext
