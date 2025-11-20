import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'

export class HealthServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 503) {
    super(message)
    this.name = 'HealthServiceError'
    this.statusCode = statusCode
  }
}

export interface HealthServiceDeps {
  prisma?: PrismaClient
  now?: () => Date
  version?: string
  memoryUsage?: () => NodeJS.MemoryUsage
}

export class HealthService {
  private prisma: PrismaClient
  private now: () => Date
  private version: string
  private memoryUsage: () => NodeJS.MemoryUsage

  constructor(deps: HealthServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.now = deps.now ?? (() => new Date())
    this.version = deps.version ?? process.env.APP_VERSION ?? 'v1.1.0'
    this.memoryUsage = deps.memoryUsage ?? process.memoryUsage
  }

  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
      return {
        status: 'healthy' as const,
        timestamp: this.now().toISOString(),
        version: this.version,
        database: 'connected',
        memory: this.memoryUsage(),
      }
    } catch (error) {
      throw new HealthServiceError(
        error instanceof Error ? error.message : 'Unknown error',
        503,
      )
    }
  }
}

export const healthService = new HealthService()
