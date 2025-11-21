import type { Connection, ModelCatalog, PrismaClient } from '@prisma/client'

export interface CachedModelWithConnection {
  connection: Connection
  rawId: string
  modelId: string
  connectionId: number
}

export interface ModelResolverRepository {
  findCachedModel(modelId: string): Promise<CachedModelWithConnection | null>
  listEnabledSystemConnections(): Promise<Connection[]>
  findEnabledSystemConnectionById(id: number): Promise<Connection | null>
}

export class PrismaModelResolverRepository implements ModelResolverRepository {
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  async findCachedModel(modelId: string): Promise<CachedModelWithConnection | null> {
    const row = await this.prisma.modelCatalog.findFirst({
      where: { modelId },
      select: {
        modelId: true,
        rawId: true,
        connectionId: true,
        connection: true,
      },
    })
    if (!row) return null
    const { connection, rawId, modelId: cachedModelId, connectionId } = row as ModelCatalog & {
      connection: Connection
    }
    return {
      connection,
      rawId,
      modelId: cachedModelId,
      connectionId,
    }
  }

  listEnabledSystemConnections() {
    return this.prisma.connection.findMany({
      where: {
        enable: true,
        ownerUserId: null,
      },
    })
  }

  findEnabledSystemConnectionById(id: number) {
    return this.prisma.connection.findFirst({
      where: {
        id,
        enable: true,
        ownerUserId: null,
      },
    })
  }
}
