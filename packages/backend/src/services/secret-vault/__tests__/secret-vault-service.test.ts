import { SecretVaultService, SecretVaultServiceError } from '../secret-vault-service'
import type { SecretVault } from '@prisma/client'
import type { SecretVaultRepository } from '../../../repositories/secret-vault-repository'

const now = new Date('2026-06-12T08:00:00.000Z')

type MockSecretVault = Pick<SecretVault, 'id' | 'scope' | 'scopeId' | 'kind' | 'label' | 'encryptedValue' | 'refId' | 'refType' | 'createdAt' | 'updatedAt'>

const ensureMasterKey = () => {
  if (!process.env.SECRET_VAULT_MASTER_KEY) {
    process.env.SECRET_VAULT_MASTER_KEY = 'test-master-key-32-bytes-long!!'
  }
}

const buildService = (overrides?: { repository?: Partial<jest.Mocked<SecretVaultRepository>>; masterKey?: string }) => {
  const key = overrides?.masterKey ?? (ensureMasterKey(), process.env.SECRET_VAULT_MASTER_KEY)
  const repository: jest.Mocked<SecretVaultRepository> = {
    create: jest.fn(),
    findById: jest.fn(),
    findByRef: jest.fn(),
    listByScope: jest.fn(),
    updateValue: jest.fn(),
    delete: jest.fn(),
    ...overrides?.repository,
  }
  const svc = new SecretVaultService({ repository: repository as any, masterKey: key })
  return { svc, repository }
}

describe('SecretVaultService', () => {
  beforeEach(() => {
    process.env.SECRET_VAULT_MASTER_KEY = 'test-master-key-32-bytes-long!!'
  })

  describe('construction', () => {
    it('fail closed when SECRET_VAULT_MASTER_KEY is not set', () => {
      delete process.env.SECRET_VAULT_MASTER_KEY

      expect(() => new SecretVaultService()).toThrow(
        /SECRET_VAULT_MASTER_KEY/,
      )
    })

    it('fail closed when SECRET_VAULT_MASTER_KEY is empty', () => {
      process.env.SECRET_VAULT_MASTER_KEY = ''

      expect(() => new SecretVaultService()).toThrow(
        /SECRET_VAULT_MASTER_KEY/,
      )
    })

    it('constructs successfully when SECRET_VAULT_MASTER_KEY is provided', () => {
      process.env.SECRET_VAULT_MASTER_KEY = 'test-master-key-32-bytes-long!!'

      expect(() => new SecretVaultService()).not.toThrow()
    })
  })

  describe('encrypt/decrypt', () => {
    it('encrypts and decrypts a value back to original plaintext', () => {
      const { svc } = buildService()
      const plaintext = 'sk-ant-api03-very-secret-key-12345'

      const encrypted = svc.encrypt(plaintext)
      expect(encrypted).toBeTruthy()
      expect(encrypted).not.toBe(plaintext)

      const decrypted = svc.decrypt(encrypted)
      expect(decrypted).toBe(plaintext)
    })

    it('produces different ciphertexts for the same plaintext (unique IV)', () => {
      const { svc } = buildService()
      const plaintext = 'same-secret'

      const enc1 = svc.encrypt(plaintext)
      const enc2 = svc.encrypt(plaintext)

      expect(enc1).not.toBe(enc2)
    })

    it('different master keys produce incompatible ciphertexts', () => {
      const { svc: svcA } = buildService({ masterKey: 'key-aaaa-32-bytes-long-aaaa!!' })
      const { svc: svcB } = buildService({ masterKey: 'key-bbbb-32-bytes-long-bbbb!!' })

      const encrypted = svcA.encrypt('secret')

      expect(() => svcB.decrypt(encrypted)).toThrow()
    })
  })

  describe('createSecret', () => {
    it('creates a secret and returns only the id', async () => {
      const { svc, repository } = buildService()
      repository.create.mockResolvedValue({
        id: 1, scope: 'system', scopeId: 'system', kind: 'api_key',
        label: 'Test Key', encryptedValue: 'encrypted-base64', refId: '42',
        refType: 'connection', createdAt: now, updatedAt: now,
      } as unknown as SecretVault & MockSecretVault)

      const result = await svc.createSecret({
        scope: 'system', scopeId: 'system', kind: 'api_key',
        label: 'Test Key', value: 'sk-secret-value', refId: '42', refType: 'connection',
      })

      expect(result).toEqual({ id: 1 })
      expect(repository.create).toHaveBeenCalledTimes(1)
      const createArg = repository.create.mock.calls[0][0]
      expect(createArg.scope).toBe('system')
      expect(createArg.kind).toBe('api_key')
      expect(createArg.encryptedValue).toBeTruthy()
      expect(createArg.encryptedValue).not.toBe('sk-secret-value')
    })
  })

  describe('getSecretView', () => {
    it('returns masked view, never exposes plaintext', async () => {
      const { svc, repository } = buildService()
      repository.findById.mockResolvedValue({
        id: 1, scope: 'system', scopeId: 'system', kind: 'api_key',
        label: 'Test Key', encryptedValue: 'some-base64-ciphertext', refId: '42',
        refType: 'connection', createdAt: now, updatedAt: now,
      } as unknown as SecretVault & MockSecretVault)

      const view = await svc.getSecretView(1)

      expect(view.id).toBe(1)
      expect(view.scope).toBe('system')
      expect(view.kind).toBe('api_key')
      expect(view.label).toBe('Test Key')
      expect(view.hasValue).toBe(true)
      expect(view.refId).toBe('42')
      expect(view.refType).toBe('connection')
      // View must never contain plaintext
      expect((view as any).value).toBeUndefined()
      expect((view as any).plaintext).toBeUndefined()
      expect((view as any).encryptedValue).toBeUndefined()
    })

    it('throws 404 for non-existent secret', async () => {
      const { svc, repository } = buildService()
      repository.findById.mockResolvedValue(null)

      await expect(svc.getSecretView(999)).rejects.toThrow(SecretVaultServiceError)
      await expect(svc.getSecretView(999)).rejects.toThrow(/不存在/)
    })
  })

  describe('decryptById', () => {
    it('decrypts a stored value back to plaintext', async () => {
      const { svc, repository } = buildService()
      const plaintext = 'sk-api-key-for-runtime'
      const encrypted = svc.encrypt(plaintext)

      repository.findById.mockResolvedValue({
        id: 1, encryptedValue: encrypted,
        scope: 'system', scopeId: 'system', kind: 'api_key',
        label: 'K', refId: null, refType: null,
        createdAt: now, updatedAt: now,
      } as unknown as SecretVault & MockSecretVault)

      const result = await svc.decryptById(1)
      expect(result).toBe(plaintext)
    })
  })

  describe('listSecrets', () => {
    it('returns views without plaintext', async () => {
      const { svc, repository } = buildService()
      repository.listByScope.mockResolvedValue([
        { id: 1, scope: 'system', scopeId: 'system', kind: 'api_key', label: 'K1',
          encryptedValue: 'enc1', refId: null, refType: null, createdAt: now, updatedAt: now },
        { id: 2, scope: 'system', scopeId: 'system', kind: 'api_key', label: 'K2',
          encryptedValue: '', refId: null, refType: null, createdAt: now, updatedAt: now },
      ] as unknown as (SecretVault & MockSecretVault)[])

      const views = await svc.listSecrets('system', 'system')

      expect(views).toHaveLength(2)
      expect(views[0].hasValue).toBe(true)
      expect(views[1].hasValue).toBe(false)
      expect((views[0] as any).value).toBeUndefined()
      expect((views[0] as any).encryptedValue).toBeUndefined()
    })
  })

  describe('updateSecretValue', () => {
    it('updates an existing secret value', async () => {
      const { svc, repository } = buildService()
      repository.findById.mockResolvedValue({
        id: 1, encryptedValue: 'old-enc',
        scope: 'system', scopeId: 'system', kind: 'api_key',
        label: 'K', refId: null, refType: null,
        createdAt: now, updatedAt: now,
      } as unknown as SecretVault & MockSecretVault)
      repository.updateValue.mockResolvedValue({} as any)

      await svc.updateSecretValue(1, 'new-secret')

      expect(repository.updateValue).toHaveBeenCalledTimes(1)
      const newEnc = repository.updateValue.mock.calls[0][1]
      expect(newEnc).toBeTruthy()
      expect(newEnc).not.toBe('new-secret')
      expect(newEnc).not.toBe('old-enc')
    })
  })

  describe('deleteSecret', () => {
    it('deletes a secret by id', async () => {
      const { svc, repository } = buildService()
      repository.findById.mockResolvedValue({
        id: 1, encryptedValue: 'enc',
      } as unknown as SecretVault & MockSecretVault)

      await svc.deleteSecret(1)

      expect(repository.delete).toHaveBeenCalledWith(1)
    })
  })
})
