import type { Connection, ConnectionGroup, Prisma, PrismaClient } from '@prisma/client'

export type ConnectionGroupWithCredentials = ConnectionGroup & { credentials: Connection[] }
export type ConnectionGroupCreateData = Prisma.ConnectionGroupUncheckedCreateInput
export type ConnectionGroupUpdateData = Prisma.ConnectionGroupUncheckedUpdateInput
export type CredentialCreateData = Prisma.ConnectionUncheckedCreateInput
export type CredentialUpdateData = Prisma.ConnectionUncheckedUpdateInput

export interface ConnectionRepository {
  listSystemGroups(): Promise<ConnectionGroupWithCredentials[]>
  findSystemGroupById(id: number): Promise<ConnectionGroupWithCredentials | null>
  createSystemGroup(data: ConnectionGroupCreateData): Promise<ConnectionGroup>
  updateSystemGroup(id: number, data: ConnectionGroupUpdateData): Promise<ConnectionGroup>
  deleteSystemGroup(id: number): Promise<void>
  createCredential(data: CredentialCreateData): Promise<Connection>
  updateCredential(id: number, data: CredentialUpdateData): Promise<Connection>
  deleteCredential(id: number): Promise<void>
  deleteModelCatalogByConnectionGroupId(connectionGroupId: number): Promise<void>
}

export class PrismaConnectionRepository implements ConnectionRepository {
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  listSystemGroups() {
    return this.prisma.connectionGroup.findMany({
      where: { ownerUserId: null },
      include: { credentials: true },
    })
  }

  findSystemGroupById(id: number) {
    return this.prisma.connectionGroup.findFirst({
      where: { id, ownerUserId: null },
      include: { credentials: true },
    })
  }

  createSystemGroup(data: ConnectionGroupCreateData) {
    return this.prisma.connectionGroup.create({ data })
  }

  updateSystemGroup(id: number, data: ConnectionGroupUpdateData) {
    return this.prisma.connectionGroup.update({ where: { id }, data })
  }

  async deleteSystemGroup(id: number) {
    await this.prisma.connectionGroup.delete({ where: { id } })
  }

  createCredential(data: CredentialCreateData) {
    return this.prisma.connection.create({ data })
  }

  updateCredential(id: number, data: CredentialUpdateData) {
    return this.prisma.connection.update({ where: { id }, data })
  }

  async deleteCredential(id: number) {
    await this.prisma.connection.delete({ where: { id } })
  }

  async deleteModelCatalogByConnectionGroupId(connectionGroupId: number) {
    await this.prisma.modelCatalog.deleteMany({ where: { connectionGroupId } })
  }
}
