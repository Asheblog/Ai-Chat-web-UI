import { setModelResolverService, getModelResolverService, resolveModelIdForUser } from '../model-resolver'
import type { ModelResolverService } from '../../services/catalog/model-resolver-service'

describe('model-resolver util', () => {
  const original = getModelResolverService()

  afterEach(() => {
    // 恢复默认，以避免污染其他测试
    setModelResolverService(original)
  })

  it('delegates to injected service', async () => {
    const mockService: jest.Mocked<ModelResolverService> = {
      resolveModelIdForUser: jest.fn().mockResolvedValue({
        connection: { id: 1 } as any,
        rawModelId: 'gpt-4o',
      }),
    }

    setModelResolverService(mockService)

    const result = await resolveModelIdForUser(42, 'gpt-4o')

    expect(mockService.resolveModelIdForUser).toHaveBeenCalledWith(42, 'gpt-4o')
    expect(result?.rawModelId).toBe('gpt-4o')
  })
})
