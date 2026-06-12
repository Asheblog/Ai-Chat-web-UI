import type { PrismaClient, SecretVault } from '@prisma/client'

export interface SecretVaultCreateData {
  scope: string
  scopeId: string
  kind: string
  label: string
  encryptedValue: string
  refId?: string | null
  refType?: string | null
  createdBy?: number | null
}

export type SecretVaultUpdateData = Partial<Pick<SecretVaultCreateData, 'label' | 'kind' | 'refId' | 'refType'>> & {
  encryptedValue?: string
}

export interface SecretVaultRepository {
  create(data: SecretVaultCreateData): Promise<SecretVault>
  findById(id: number): Promise<SecretVault | null>
  findByRef(refType: string, refId: string): Promise<SecretVault | null>
  listByScope(scope: string, scopeId: string): Promise<SecretVault[]>
  updateValue(id: number, encryptedValue: string): Promise<SecretVault>
  update(id: number, data: SecretVaultUpdateData): Promise<SecretVault>
  delete(id: number): Promise<void>
}

export class PrismaSecretVaultRepository implements SecretVaultRepository {
  private prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  create(data: SecretVaultCreateData) {
    return this.prisma.secretVault.create({ data })
  }

  findById(id: number) {
    return this.prisma.secretVault.findUnique({ where: { id } })
  }

  findByRef(refType: string, refId: string) {
    return this.prisma.secretVault.findFirst({
      where: { refType, refId },
    })
  }

  listByScope(scope: string, scopeId: string) {
    return this.prisma.secretVault.findMany({
      where: { scope, scopeId },
      orderBy: { createdAt: 'desc' },
    })
  }

  updateValue(id: number, encryptedValue: string) {
    return this.prisma.secretVault.update({
      where: { id },
      data: { encryptedValue },
    })
  }

  update(id: number, data: SecretVaultUpdateData) {
    const { encryptedValue, label, kind, refId, refType } = data
    return this.prisma.secretVault.update({
      where: { id },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(refId !== undefined ? { refId } : {}),
        ...(refType !== undefined ? { refType } : {}),
        ...(encryptedValue !== undefined ? { encryptedValue } : {}),
      },
    })
  }

  async delete(id: number) {
    await this.prisma.secretVault.delete({ where: { id } })
  }
}
