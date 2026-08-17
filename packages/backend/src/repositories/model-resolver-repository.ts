import type { Connection, ConnectionGroup, PrismaClient } from '@prisma/client'

export type ResolvedConnection = ConnectionGroup & {
  /** Selected credential id used for vault / key selection */
  credentialId: number
  secretVaultId: number | null
  modelIdsJson: string
  apiKeyLabel: string | null
}

export interface CachedModelWithConnection {
  connection: ResolvedConnection
  rawId: string
  modelId: string
  connectionId: number
  metaJson?: string | null
}

export interface ModelResolverRepository {
  findCachedModel(modelId: string): Promise<CachedModelWithConnection | null>
  listEnabledSystemGroups(): Promise<Array<ConnectionGroup & { credentials: Connection[] }>>
  /**
   * Dual-read: group id, or legacy credential id → its group.
   * Returns a ResolvedConnection (group fields + selected credential vault).
   */
  findEnabledResolvedConnectionById(id: number): Promise<ResolvedConnection | null>
}

const pickCredential = (group: ConnectionGroup, credentials: Connection[]): Connection | null => {
  const enabled = credentials.filter((item) => item.enable)
  const pool = enabled.length > 0 ? enabled : credentials
  if (pool.length === 0) return null
  if (group.authType === 'none') {
    return pool[0] ?? null
  }
  return pool.find((item) => item.secretVaultId != null) ?? pool[0] ?? null
}

const toResolved = (
  group: ConnectionGroup,
  credential: Connection,
): ResolvedConnection => ({
  ...group,
  credentialId: credential.id,
  secretVaultId: credential.secretVaultId,
  modelIdsJson: credential.modelIdsJson,
  apiKeyLabel: credential.apiKeyLabel,
})

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
        connectionGroupId: true,
        metaJson: true,
        connectionGroup: {
          include: { credentials: true },
        },
      },
    })
    if (!row?.connectionGroup) return null

    const credential = pickCredential(row.connectionGroup, row.connectionGroup.credentials)
    if (!credential) return null

    return {
      connection: toResolved(row.connectionGroup, credential),
      rawId: row.rawId,
      modelId: row.modelId,
      connectionId: row.connectionGroupId,
      metaJson: row.metaJson,
    }
  }

  listEnabledSystemGroups() {
    return this.prisma.connectionGroup.findMany({
      where: {
        enable: true,
        ownerUserId: null,
      },
      include: { credentials: true },
    })
  }

  async findEnabledResolvedConnectionById(id: number): Promise<ResolvedConnection | null> {
    const asGroup = await this.prisma.connectionGroup.findFirst({
      where: {
        id,
        enable: true,
        ownerUserId: null,
      },
      include: { credentials: true },
    })
    if (asGroup) {
      const credential = pickCredential(asGroup, asGroup.credentials)
      if (!credential) return null
      return toResolved(asGroup, credential)
    }

    const credential = await this.prisma.connection.findFirst({
      where: { id, enable: true },
      include: { group: true },
    })
    if (!credential?.group || credential.group.ownerUserId != null || !credential.group.enable) {
      return null
    }
    return toResolved(credential.group, credential)
  }
}
