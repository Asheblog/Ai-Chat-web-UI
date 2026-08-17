import { describe, expect, it } from 'vitest'
import {
  collectDuplicateModelNames,
  formatModelOptionLabel,
  formatModelSecondaryLabel,
  modelProviderLabel,
} from './model-display'

describe('model-display', () => {
  it('maps provider codes to readable labels', () => {
    expect(modelProviderLabel('openai')).toBe('OpenAI')
    expect(modelProviderLabel('azure_openai')).toBe('Azure')
    expect(modelProviderLabel('Custom')).toBe('Custom')
  })

  it('formats accessible option label as name · displayName', () => {
    expect(
      formatModelOptionLabel({
        name: 'GPT-4o',
        displayName: 'Prod OpenAI',
        provider: 'openai',
      })
    ).toBe('GPT-4o · Prod OpenAI')

    expect(
      formatModelOptionLabel({
        name: 'GPT-4o',
        displayName: null,
        provider: 'openai',
      })
    ).toBe('GPT-4o · openai')
  })

  it('formats secondary label as displayName · providerLabel', () => {
    expect(
      formatModelSecondaryLabel({
        displayName: 'Prod OpenAI',
        provider: 'openai',
      })
    ).toBe('Prod OpenAI · OpenAI')

    expect(
      formatModelSecondaryLabel({
        displayName: '',
        provider: 'ollama',
      })
    ).toBe('Ollama')
  })

  it('collects duplicate model names', () => {
    expect(
      collectDuplicateModelNames([
        { name: 'GPT-4o' },
        { name: 'GPT-4o' },
        { name: 'Claude' },
      ])
    ).toEqual(new Set(['GPT-4o']))
  })
})
