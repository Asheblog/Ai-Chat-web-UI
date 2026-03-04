import { describe, expect, it } from 'vitest'
import type { ModelItem } from '@/store/models-store'
import { modelKeyFor } from '@/store/model-preference-store'
import { isModelSelected, matchesStoredModelId } from './model-selector-utils'

const makeModel = (override: Partial<ModelItem>): ModelItem => ({
  id: 'gpt-4o',
  rawId: 'gpt-4o',
  name: 'GPT-4o',
  provider: 'openai',
  channelName: 'openai',
  connectionBaseUrl: 'https://api.example.com/v1',
  connectionId: 1,
  ...override,
})

describe('model-selector-utils', () => {
  it('only treats exact model key as selected', () => {
    const modelA = makeModel({ connectionId: 1, id: 'gpt-4o', rawId: 'gpt-4o' })
    const modelB = makeModel({ connectionId: 2, id: 'gpt-4o', rawId: 'gpt-4o' })
    const selectedKey = modelKeyFor(modelA)

    expect(isModelSelected(modelA, selectedKey)).toBe(true)
    expect(isModelSelected(modelB, selectedKey)).toBe(false)
    expect(isModelSelected(modelA, modelA.id)).toBe(false)
    expect(isModelSelected(modelA, modelA.rawId)).toBe(false)
  })

  it('matches stored model ids by key only', () => {
    const model = makeModel({ connectionId: 7, id: 'claude-3-7-sonnet', rawId: 'claude-3-7-sonnet' })
    const key = modelKeyFor(model)

    expect(matchesStoredModelId(model, key)).toBe(true)
    expect(matchesStoredModelId(model, model.id)).toBe(false)
    expect(matchesStoredModelId(model, model.rawId)).toBe(false)
  })
})
