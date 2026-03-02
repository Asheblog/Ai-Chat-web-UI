import type { Connection, Prisma, PrismaClient } from '@prisma/client'

export type ConnectionCreateData = Prisma.ConnectionUncheckedCreateInput
export type ConnectionUpdateData = Prisma.ConnectionUncheckedUpdateInput

export interface ConnectionRepository {
  listSystemConnections(): Promise<Connection[]>
  createSystemConnection(data: ConnectionCreateData): Promise<Connection>
  findSystemConnectionById(id: number): Promise<Connection | null>
  updateSystemConnection(id: number, data: ConnectionUpdateData): Promise<Connection>
  deleteSystemConnection(id: number): Promise<void>
  deleteModelCatalogByConnectionId(connectionId: number): Promise<void>
}

export class PrismaConnectionRepository implements ConnectionRepository {
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  listSystemConnections() {
    return this.prisma.connection.findMany({
      where: { ownerUserId: null },
    })
  }

  createSystemConnection(data: ConnectionCreateData) {
    return this.prisma.connection.create({ data })
  }

  findSystemConnectionById(id: number) {
    return this.prisma.connection.findUnique({ where: { id } })
  }

  updateSystemConnection(id: number, data: ConnectionUpdateData) {
    return this.prisma.connection.update({ where: { id }, data })
  }

  async deleteSystemConnection(id: number) {
    await this.prisma.connection.delete({ where: { id } })
  }

  async deleteModelCatalogByConnectionId(connectionId: number) {
    await this.prisma.modelCatalog.deleteMany({ where: { connectionId } })
  }
}
