jest.mock('../../utils/model-catalog', () => ({
  refreshModelCatalogForConnection: jest.fn(),
  refreshAllModelCatalog: jest.fn(),
  refreshModelCatalogForConnections: jest.fn(),
  refreshModelCatalogForConnectionId: jest.fn(),
}))
jest.mock('../../utils/providers', () => ({
  verifyConnection: jest.fn(),
  computeCapabilities: jest.fn(),
  deriveChannelName: jest.fn(),
}))

import { createAppContainer } from '../app-container'
import type { ModelResolverRepository } from '../../repositories/model-resolver-repository'

const createMockRepository = () => ({
  listSystemConnections: jest.fn().mockResolvedValue([]),
  createSystemConnection: jest.fn(),
  findSystemConnectionById: jest.fn(),
  updateSystemConnection: jest.fn(),
  deleteSystemConnection: jest.fn(),
  deleteModelCatalogByConnectionId: jest.fn(),
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

    expect(repo.listSystemConnections).toHaveBeenCalled()
  })

  it('wires modelResolverService with injected repository', async () => {
    const repo: jest.Mocked<ModelResolverRepository> = {
      findCachedModel: jest.fn().mockResolvedValue(null),
      listEnabledSystemConnections: jest.fn().mockResolvedValue([] as any),
      findEnabledSystemConnectionById: jest.fn().mockResolvedValue(null),
    }
    const container = createAppContainer({
      modelResolverRepository: repo,
    })

    await container.modelResolverService.resolveModelIdForUser(1, 'gpt-4o')

    expect(repo.findCachedModel).toHaveBeenCalledWith('gpt-4o')
  })
})
