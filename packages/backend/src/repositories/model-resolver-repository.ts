import type { Connection, ConnectionGroup, PrismaClient } from '@prisma/client'
import { isSupportedProvider } from '../utils/providers'

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
  /** Includes disabled groups so retired model identities cannot fall through. */
  listSystemGroupsForResolution(): Promise<Array<ConnectionGroup & { credentials: Connection[] }>>
  /**
   * Dual-read: group id, or legacy credential id → its group.
   * Returns a ResolvedConnection (group fields + selected credential vault).
   */
  findEnabledResolvedConnectionById(id: number): Promise<ResolvedConnection | null>
  /** Supported providers only; without enable filter for system soft-refs. */
  findResolvedConnectionById(id: number): Promise<ResolvedConnection | null>
}

export const pickPrimaryCredential = (
  group: ConnectionGroup,
  credentials: Connection[],
): Connection | null => {
  const enabled = credentials.filter((item) => item.enable)
  const pool = enabled.length > 0 ? enabled : credentials
  if (pool.length === 0) return null
  if (group.authType === 'none') {
    return pool[0] ?? null
  }
  return pool.find((item) => item.secretVaultId != null) ?? pool[0] ?? null
}

export const toResolvedConnection = (
  group: ConnectionGroup,
  credential: Connection,
): ResolvedConnection => ({
  ...group,
  credentialId: credential.id,
  secretVaultId: credential.secretVaultId,
  modelIdsJson: credential.modelIdsJson,
  apiKeyLabel: credential.apiKeyLabel,
})

export const resolveConnectionFromGroup = (
  group: ConnectionGroup & { credentials: Connection[] },
): ResolvedConnection | null => {
  const credential = pickPrimaryCredential(group, group.credentials)
  if (!credential) return null
  return toResolvedConnection(group, credential)
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
        connectionGroupId: true,
        metaJson: true,
        connectionGroup: {
          include: { credentials: true },
        },
      },
    })
    if (!row?.connectionGroup) return null

    const credential = pickPrimaryCredential(row.connectionGroup, row.connectionGroup.credentials)
    if (!credential) return null

    return {
      connection: toResolvedConnection(row.connectionGroup, credential),
      rawId: row.rawId,
      modelId: row.modelId,
      connectionId: row.connectionGroupId,
      metaJson: row.metaJson,
    }
  }

  listSystemGroupsForResolution() {
    return this.prisma.connectionGroup.findMany({
      where: {
        ownerUserId: null,
      },
      include: { credentials: true },
    })
  }

  async findEnabledResolvedConnectionById(id: number): Promise<ResolvedConnection | null> {
    const asGroup = await this.prisma.connectionGroup.findFirst({
      where: {
        id,
        ownerUserId: null,
      },
      include: { credentials: true },
    })
    if (asGroup) {
      if (!asGroup.enable || !isSupportedProvider(asGroup.provider)) return null
      return resolveConnectionFromGroup(asGroup)
    }

    const credential = await this.prisma.connection.findFirst({
      where: { id, enable: true },
      include: { group: true },
    })
    if (!credential?.group || credential.group.ownerUserId != null || !credential.group.enable || !isSupportedProvider(credential.group.provider)) {
      return null
    }
    return toResolvedConnection(credential.group, credential)
  }

  /**
   * Dual-read without enable filter — for system soft-refs (title/vision/rag settings).
   */
  async findResolvedConnectionById(id: number): Promise<ResolvedConnection | null> {
    const asGroup = await this.prisma.connectionGroup.findFirst({
      where: { id, ownerUserId: null },
      include: { credentials: true },
    })
    if (asGroup) {
      if (!isSupportedProvider(asGroup.provider)) return null
      return resolveConnectionFromGroup(asGroup)
    }

    const credential = await this.prisma.connection.findFirst({
      where: { id },
      include: { group: true },
    })
    if (!credential?.group || credential.group.ownerUserId != null || !isSupportedProvider(credential.group.provider)) {
      return null
    }
    return toResolvedConnection(credential.group, credential)
  }
}
