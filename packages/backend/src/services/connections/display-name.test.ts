import {
  allocateUniqueDisplayName,
  formatModelOptionLabel,
  seedDisplayName,
} from './display-name'

describe('connection group display names', () => {
  test('prefers a non-empty prefix for its display-name seed', () => {
    expect(
      seedDisplayName({
        prefixId: '  production-openai  ',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      }),
    ).toBe('production-openai')
  })

  test('falls back to channel name derived from baseUrl when no prefix exists', () => {
    expect(
      seedDisplayName({
        prefixId: ' ',
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
      }),
    ).toBe('example')
  })

  test('falls back to provider when prefix and baseUrl yield nothing useful', () => {
    expect(
      seedDisplayName({
        prefixId: '',
        provider: 'openai',
        baseUrl: '',
      }),
    ).toBe('openai')
  })

  test('allocates incrementing suffixes without changing the seed', () => {
    const taken = new Set(['OpenAI', 'OpenAI-2'])

    expect(allocateUniqueDisplayName('OpenAI', taken)).toBe('OpenAI-3')
    expect(taken).toEqual(new Set(['OpenAI', 'OpenAI-2']))
  })

  test('formats model labels with stable group display names', () => {
    expect(
      formatModelOptionLabel({
        name: 'GPT-4o',
        displayName: 'Production',
        provider: 'openai',
      }),
    ).toBe('GPT-4o · Production')
  })
})
