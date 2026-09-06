import type { Connection, ConnectionGroup } from '@prisma/client'
import { buildConfigFromGroup, refreshModelCatalogForConnectionGroup, refreshModelCatalogForConnectionGroups } from './model-catalog'

describe('retired catalog refresh', () => {
  test.each(['azure_openai', 'ollama'])('never decrypts credentials or refreshes %s', async (provider) => {
    const group = { id: 1, provider, ownerUserId: null, authType: 'bearer', enable: true } as ConnectionGroup
    const credential = { id: 1, secretVaultId: 10, enable: true } as Connection
    const vault = { decryptById: jest.fn() } as any
    await expect(buildConfigFromGroup(group, credential, vault)).rejects.toThrow('Unsupported provider')
    await expect(refreshModelCatalogForConnectionGroup(group, credential, vault)).rejects.toThrow('Unsupported provider')
    await expect(refreshModelCatalogForConnectionGroups([{ ...group, credentials: [credential] }], vault)).resolves.toBeUndefined()
    expect(vault.decryptById).not.toHaveBeenCalled()
  })
})
