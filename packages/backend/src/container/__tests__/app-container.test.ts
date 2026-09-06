process.env.SECRET_VAULT_MASTER_KEY = 'test-master-key-32-bytes-long!!'

jest.mock('../../utils/model-catalog', () => ({
  refreshModelCatalogForConnectionGroup: jest.fn(),
  refreshAllModelCatalog: jest.fn(),
  refreshModelCatalogForConnectionGroups: jest.fn(),
  refreshModelCatalogForConnectionGroupId: jest.fn(),
}))
jest.mock('../../utils/providers', () => ({
  verifyConnection: jest.fn(),
  computeCapabilities: jest.fn(),
  deriveChannelName: jest.fn(),
}))

import { createAppContainer } from '../app-container'
import type { ModelResolverRepository } from '../../repositories/model-resolver-repository'

const createMockRepository = () => ({
  listSystemGroups: jest.fn().mockResolvedValue([]),
  findSystemGroupById: jest.fn(),
  createSystemGroup: jest.fn(),
  updateSystemGroup: jest.fn(),
  deleteSystemGroup: jest.fn(),
  createCredential: jest.fn(),
  updateCredential: jest.fn(),
  deleteCredential: jest.fn(),
  deleteModelCatalogByConnectionGroupId: jest.fn(),
})

describe('AppContainer', () => {
  it('uses provided connectionService when supplied', () => {
    const fakeService = {
      listSystemConnections: jest.fn(),
    } as any
    const container = createAppContainer({ connectionService: fakeService })
    expect(container.connectionService).toBe(fakeService)
  })

  it('wires repository into connectionService by default', async () => {
    const repo = createMockRepository()
    const container = createAppContainer({
      connectionRepository: repo as any,
    })

    await container.connectionService.listSystemConnections()

    expect(repo.listSystemGroups).toHaveBeenCalled()
  })

  it('wires modelResolverService with injected repository', async () => {
    const repo: jest.Mocked<ModelResolverRepository> = {
      findCachedModel: jest.fn().mockResolvedValue(null),
      listSystemGroupsForResolution: jest.fn().mockResolvedValue([] as any),
      findEnabledResolvedConnectionById: jest.fn().mockResolvedValue(null),
    }
    const container = createAppContainer({
      modelResolverRepository: repo,
    })

    await container.modelResolverService.resolveModelIdForUser(1, 'gpt-4o')

    expect(repo.findCachedModel).toHaveBeenCalledWith('gpt-4o')
  })

  it('binds secretVault into model catalog refresh callbacks', async () => {
    const modelCatalog = jest.requireMock('../../utils/model-catalog') as {
      refreshAllModelCatalog: jest.Mock
    }
    modelCatalog.refreshAllModelCatalog.mockClear()

    const container = createAppContainer()
    await container.modelCatalogService.refreshAllModels()
    expect(modelCatalog.refreshAllModelCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ decryptById: expect.any(Function) }),
    )
  })

  it('wires battle executor ChatRequestBuilder with secretVault', () => {
    const container = createAppContainer()
    const requestBuilder = (container.battleService as any).executor?.requestBuilder
    expect(requestBuilder).toBeDefined()
    expect((requestBuilder as any).secretVault).toEqual(
      expect.objectContaining({ decryptById: expect.any(Function) }),
    )
  })
})
