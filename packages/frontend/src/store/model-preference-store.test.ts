import { describe, expect, it } from 'vitest'
import type { ModelItem } from '@/store/models-store'
import type { PreferredModelState } from './model-preference-store'
import { findPreferredModel } from './model-preference-store'

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

describe('findPreferredModel', () => {
  it('prefers exact connectionId + rawId match', () => {
    const models = [
      makeModel({ connectionId: 1 }),
      makeModel({ connectionId: 2 }),
    ]
    const preferred: PreferredModelState = {
      modelId: 'gpt-4o',
      connectionId: 2,
      rawId: 'gpt-4o',
    }

    const resolved = findPreferredModel(models, preferred)
    expect(resolved?.connectionId).toBe(2)
  })

  it('returns null for ambiguous id-only preference', () => {
    const models = [
      makeModel({ connectionId: 1, id: 'same-id', rawId: 'same-raw' }),
      makeModel({ connectionId: 2, id: 'same-id', rawId: 'same-raw' }),
    ]
    const preferred: PreferredModelState = {
      modelId: 'same-id',
      connectionId: null,
      rawId: null,
    }

    expect(findPreferredModel(models, preferred)).toBeNull()
  })
})
