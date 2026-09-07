import {
  THINKING_DIALECTS,
  inferThinkingDialectFromBaseUrl,
  legacyVendorToThinkingDialect,
  normalizeThinkingDialect,
} from '@aichat/shared'

describe('thinking-dialect helpers', () => {
  it('exposes the supported dialect constants', () => {
    expect(THINKING_DIALECTS).toEqual(['off', 'deepseek_compat'])
  })

  it('normalizes unknown values to off and keeps deepseek_compat', () => {
    expect(normalizeThinkingDialect('deepseek_compat')).toBe('deepseek_compat')
    expect(normalizeThinkingDialect('off')).toBe('off')
    expect(normalizeThinkingDialect(undefined)).toBe('off')
    expect(normalizeThinkingDialect(null)).toBe('off')
    expect(normalizeThinkingDialect('openai_interleave')).toBe('off')
    expect(normalizeThinkingDialect(1)).toBe('off')
  })

  it('infers deepseek_compat from deepseek / siliconflow hosts (case-insensitive)', () => {
    expect(inferThinkingDialectFromBaseUrl('https://api.deepseek.com/v1')).toBe('deepseek_compat')
    expect(inferThinkingDialectFromBaseUrl('https://API.DeepSeek.com/v1')).toBe('deepseek_compat')
    expect(inferThinkingDialectFromBaseUrl('https://api.siliconflow.cn/v1')).toBe('deepseek_compat')
    expect(inferThinkingDialectFromBaseUrl('https://api.SiliconFlow.cn/v1')).toBe('deepseek_compat')
    expect(inferThinkingDialectFromBaseUrl('https://api.openai.com/v1')).toBe('off')
    expect(inferThinkingDialectFromBaseUrl('not-a-url')).toBe('off')
  })

  it('maps legacy vendor values to deepseek_compat', () => {
    expect(legacyVendorToThinkingDialect('deepseek')).toBe('deepseek_compat')
    expect(legacyVendorToThinkingDialect('openai_interleave')).toBe('deepseek_compat')
    expect(legacyVendorToThinkingDialect(null)).toBe('off')
    expect(legacyVendorToThinkingDialect(undefined)).toBe('off')
    expect(legacyVendorToThinkingDialect('other')).toBe('off')
  })
})
