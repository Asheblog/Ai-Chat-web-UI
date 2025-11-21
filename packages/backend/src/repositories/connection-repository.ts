import type { Connection, Prisma, PrismaClient } from '@prisma/client'

export type ConnectionWriteData =
  | Prisma.ConnectionUncheckedCreateInput
  | Prisma.ConnectionUncheckedUpdateInput

export interface ConnectionRepository {
  listSystemConnections(): Promise<Connection[]>
  createSystemConnection(data: ConnectionWriteData): Promise<Connection>
  findSystemConnectionById(id: number): Promise<Connection | null>
  updateSystemConnection(id: number, data: ConnectionWriteData): Promise<Connection>
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

  createSystemConnection(data: ConnectionWriteData) {
    return this.prisma.connection.create({ data })
  }

  findSystemConnectionById(id: number) {
    return this.prisma.connection.findUnique({ where: { id } })
  }

  updateSystemConnection(id: number, data: ConnectionWriteData) {
    return this.prisma.connection.update({ where: { id }, data })
  }

  async deleteSystemConnection(id: number) {
    await this.prisma.connection.delete({ where: { id } })
  }

  deleteModelCatalogByConnectionId(connectionId: number) {
    return this.prisma.modelCatalog.deleteMany({ where: { connectionId } })
  }
}
