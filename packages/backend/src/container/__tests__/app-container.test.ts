jest.mock('../../utils/model-catalog', () => ({
  refreshModelCatalogForConnection: jest.fn(),
}))
jest.mock('../../utils/providers', () => ({
  verifyConnection: jest.fn(),
}))

import { createAppContainer } from '../app-container'

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
})
