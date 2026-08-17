import { describe, expect, it } from 'vitest'
import { buildModelKey, modelKeyFor, parseModelKey } from './model-key'

describe('battle model-key', () => {
  it('builds connection-scoped keys as connectionId:rawId', () => {
    expect(buildModelKey({ modelId: 'gpt-4o', connectionId: 12, rawId: 'gpt-4o' })).toBe('12:gpt-4o')
    expect(modelKeyFor({ id: 'gpt-4o', connectionId: 12, rawId: 'gpt-4o' })).toBe('12:gpt-4o')
  })

  it('parses connection keys back to connectionId + rawId', () => {
    expect(parseModelKey('12:gpt-4o')).toEqual({
      type: 'connection',
      connectionId: 12,
      rawId: 'gpt-4o',
    })
  })
})
