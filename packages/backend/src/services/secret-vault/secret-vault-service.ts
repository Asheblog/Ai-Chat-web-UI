import crypto from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  PrismaSecretVaultRepository,
  type SecretVaultRepository,
} from '../../repositories/secret-vault-repository'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

export class SecretVaultServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'SecretVaultServiceError'
    this.statusCode = statusCode
  }
}

function deriveKey(masterKey: string): Buffer {
  return crypto.createHash('sha256').update(masterKey).digest()
}

export interface SecretCreateParams {
  scope: 'system' | 'user'
  scopeId: string
  kind: string
  label: string
  value: string
  refId?: string | null
  refType?: string | null
  createdBy?: number | null
}

export interface SecretView {
  id: number
  scope: string
  scopeId: string
  kind: string
  label: string
  hasValue: boolean
  refId: string | null
  refType: string | null
  createdAt: string
  updatedAt: string
}

export interface SecretVaultServiceDeps {
  prisma?: PrismaClient
  repository?: SecretVaultRepository
  masterKey?: string
}

export class SecretVaultService {
  private masterKey: Buffer
  private repository: SecretVaultRepository

  constructor(deps: SecretVaultServiceDeps = {}) {
    const raw = deps.masterKey ?? process.env.SECRET_VAULT_MASTER_KEY
    if (!raw || !raw.trim()) {
      throw new SecretVaultServiceError(
        'SECRET_VAULT_MASTER_KEY 环境变量未设置或为空。Secret Vault 需要显式主密钥才能运行。' +
          '请生成一个强随机密钥并配置 SECRET_VAULT_MASTER_KEY，' +
          '可参考部署文档或启动脚本生成持久化密钥。',
        500,
      )
    }
    this.masterKey = deriveKey(raw.trim())
    const prisma = deps.prisma ?? defaultPrisma
    this.repository = deps.repository ?? new PrismaSecretVaultRepository(prisma)
  }

  /** Encrypt plaintext with AES-256-GCM. Returns base64: iv + authTag + ciphertext */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    return Buffer.concat([iv, authTag, encrypted]).toString('base64')
  }

  /** Decrypt AES-256-GCM ciphertext (base64: iv + authTag + ciphertext). Returns plaintext. */
  decrypt(encryptedBase64: string): string {
    const data = Buffer.from(encryptedBase64, 'base64')
    const iv = data.subarray(0, IV_LENGTH)
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

    const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(ciphertext) + decipher.final('utf-8')
  }

  /** Create a new secret. Returns only the id, never the plaintext. */
  async createSecret(params: SecretCreateParams): Promise<{ id: number }> {
    const encryptedValue = this.encrypt(params.value)
    const record = await this.repository.create({
      scope: params.scope,
      scopeId: params.scopeId,
      kind: params.kind,
      label: params.label,
      encryptedValue,
      refId: params.refId ?? null,
      refType: params.refType ?? null,
      createdBy: params.createdBy ?? null,
    })
    return { id: record.id }
  }

  /** Decrypt a secret value for runtime use. Never exposed to API responses. */
  async decryptById(id: number): Promise<string> {
    const record = await this.repository.findById(id)
    if (!record) {
      throw new SecretVaultServiceError(`Secret #${id} 不存在`, 404)
    }
    return this.decrypt(record.encryptedValue)
  }

  /** Get a masked view of a secret. Never includes plaintext. */
  async getSecretView(id: number): Promise<SecretView> {
    const record = await this.repository.findById(id)
    if (!record) {
      throw new SecretVaultServiceError(`Secret #${id} 不存在`, 404)
    }
    return this.toView(record)
  }

  /** List secrets by scope. Never includes plaintext. */
  async listSecrets(scope: string, scopeId: string): Promise<SecretView[]> {
    const records = await this.repository.listByScope(scope, scopeId)
    return records.map((r) => this.toView(r))
  }

  /** List secrets by scope with optional kind filter. Never includes plaintext. */
  async listSecretsByKind(scope: string, scopeId: string, kind?: string): Promise<SecretView[]> {
    const records = await this.repository.listByScope(scope, scopeId)
    const filtered = kind ? records.filter((r) => r.kind === kind) : records
    return filtered.map((r) => this.toView(r))
  }

  /** Update an existing secret's value. */
  async updateSecretValue(id: number, value: string): Promise<void> {
    const record = await this.repository.findById(id)
    if (!record) {
      throw new SecretVaultServiceError(`Secret #${id} 不存在`, 404)
    }
    await this.repository.updateValue(id, this.encrypt(value))
  }

  /** Update secret fields (label/kind/refType/refId) and optionally value. Returns masked view. */
  async updateSecret(
    id: number,
    params: {
      label?: string
      kind?: string
      refId?: string | null
      refType?: string | null
      value?: string
    },
  ): Promise<SecretView> {
    const record = await this.repository.findById(id)
    if (!record) {
      throw new SecretVaultServiceError(`Secret #${id} 不存在`, 404)
    }
    const updateData: Record<string, unknown> = {}
    if (params.label !== undefined) updateData.label = params.label
    if (params.kind !== undefined) updateData.kind = params.kind
    if (params.refId !== undefined) updateData.refId = params.refId
    if (params.refType !== undefined) updateData.refType = params.refType
    if (params.value !== undefined) {
      updateData.encryptedValue = this.encrypt(params.value)
    }
    const updated = await this.repository.update(id, updateData as any)
    return this.toView(updated)
  }

  /** Find a secret by reference, decrypt for runtime use. */
  async decryptByRef(refType: string, refId: string): Promise<string | null> {
    const record = await this.repository.findByRef(refType, refId)
    if (!record) return null
    return this.decrypt(record.encryptedValue)
  }

  /** Delete a secret. */
  async deleteSecret(id: number): Promise<void> {
    const record = await this.repository.findById(id)
    if (!record) {
      throw new SecretVaultServiceError(`Secret #${id} 不存在`, 404)
    }
    await this.repository.delete(id)
  }

  /** Delete a secret by reference. */
  async deleteByRef(refType: string, refId: string): Promise<void> {
    const record = await this.repository.findByRef(refType, refId)
    if (record) {
      await this.repository.delete(record.id)
    }
  }

  private toView(record: {
    id: number
    scope: string
    scopeId: string
    kind: string
    label: string
    encryptedValue: string
    refId: string | null
    refType: string | null
    createdAt: Date
    updatedAt: Date
  }): SecretView {
    return {
      id: record.id,
      scope: record.scope,
      scopeId: record.scopeId,
      kind: record.kind,
      label: record.label,
      hasValue: Boolean(record.encryptedValue),
      refId: record.refId,
      refType: record.refType,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
  }
}
