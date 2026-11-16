import { computeCapabilities, fetchModelsForConnection } from '../providers'

describe('capability heuristics have a single source', () => {
  it('keeps model-name heuristics', () => {
    expect(computeCapabilities('gpt-4o')).toEqual({ vision: true })
    expect(computeCapabilities('flux-image-gen')).toEqual({ image_generation: true })
  })

  it('does not treat connection tags as capability declarations', async () => {
    const models = await fetchModelsForConnection({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      enable: true,
      authType: 'bearer',
      apiKey: 'sk-test',
      tags: [{ name: 'vision' }, { name: 'image_generation' }],
      modelIds: ['text-only-model'],
    })
    expect(models).toHaveLength(1)
    expect(models[0].capabilities).toBeUndefined()
  })

  it('does not carry the retired external/local connection type', async () => {
    const models = await fetchModelsForConnection({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1',
      enable: true,
      authType: 'bearer',
      modelIds: ['gpt-4o'],
    })
    expect(Object.prototype.hasOwnProperty.call(models[0], 'connectionType')).toBe(false)
  })
})
