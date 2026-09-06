process.env.SECRET_VAULT_MASTER_KEY = 'test-master-key-32-bytes-long!!'

jest.mock('../../services/battle/battle-executor', () => ({
  BattleExecutor: jest.fn(),
}))

jest.mock('../../utils/model-catalog', () => ({
  refreshModelCatalogForConnectionGroup: jest.fn(),
  refreshAllModelCatalog: jest.fn(),
  refreshModelCatalogForConnectionGroups: jest.fn(),
  refreshModelCatalogForConnectionGroupId: jest.fn(),
}))

import { createAppContainer } from '../app-container'
import { createAppContext } from '../../context/app-context'
import { getAppConfig } from '../../config/app-config'
import { BattleExecutor } from '../../services/battle/battle-executor'

describe('container provider requester wiring', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('shares the configured requester with Battle execution', () => {
    const container = createAppContainer()
    expect(BattleExecutor).toHaveBeenLastCalledWith(expect.objectContaining({
      requestBuilder: container.chatRequestBuilder,
      requester: container.providerRequester,
    }))
  })

  it('uses context transport and retry policy for the shared requester', async () => {
    jest.useFakeTimers()
    const globalFetch = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('unexpected'))
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok'))
    const context = createAppContext({
      fetchImpl,
      config: { ...getAppConfig(), retry: { upstream429Ms: 123, upstream5xxMs: 456 } },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn() },
    })
    const container = createAppContainer({ context })
    const pending = container.providerRequester.requestWithBackoff({
      request: { url: 'https://provider.example/chat', headers: {}, body: {} },
      context: { sessionId: 1, provider: 'openai', route: '/test', timeoutMs: 30000 },
    })
    await jest.advanceTimersByTimeAsync(122)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await jest.advanceTimersByTimeAsync(1)
    expect((await pending).status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(globalFetch).not.toHaveBeenCalled()
  })
})
