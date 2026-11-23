import {
  addUsageNumbers,
  isUsageNumbersNonZero,
  readUsageNumbers,
} from '../usage-numbers'

describe('readUsageNumbers', () => {
  it('returns null when the provider returned no usage at all', () => {
    expect(readUsageNumbers(undefined)).toBeNull()
    expect(readUsageNumbers(null)).toBeNull()
    expect(readUsageNumbers('nope')).toBeNull()
    expect(readUsageNumbers({})).toBeNull()
  })

  it('keeps explicit zero usage distinct from a missing usage', () => {
    const zeros = readUsageNumbers({ prompt_tokens: 0, completion_tokens: 0 })

    expect(zeros).toEqual({ prompt: 0, completion: 0, total: 0, cacheHit: 0, cacheMiss: 0 })
    expect(isUsageNumbersNonZero(zeros)).toBe(false)
    expect(readUsageNumbers({})).toBeNull()
  })

  it('reads responses-style usage field names', () => {
    expect(readUsageNumbers({ input_tokens: 12, output_tokens: 5 })).toMatchObject({
      prompt: 12,
      completion: 5,
      total: 17,
    })
  })

  it('accepts numeric strings from gateways but still distinguishes a missing field', () => {
    expect(readUsageNumbers({ prompt_tokens: '12', completion_tokens: '5' })).toMatchObject({
      prompt: 12,
      completion: 5,
      total: 17,
    })
    expect(readUsageNumbers({ prompt_tokens: null, completion_tokens: undefined })).toBeNull()
  })

  it('keeps cache hit and miss counters', () => {
    expect(
      readUsageNumbers({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_cache_hit_tokens: 60,
        prompt_cache_miss_tokens: 40,
      }),
    ).toEqual({ prompt: 100, completion: 20, total: 120, cacheHit: 60, cacheMiss: 40 })
  })
})

describe('addUsageNumbers', () => {
  it('accumulates round totals once per round', () => {
    const first = addUsageNumbers(null, { prompt: 10, completion: 2, total: 12, cacheHit: 0, cacheMiss: 0 })
    const second = addUsageNumbers(first, { prompt: 20, completion: 3, total: 23, cacheHit: 5, cacheMiss: 1 })

    expect(second).toEqual({ prompt: 30, completion: 5, total: 35, cacheHit: 5, cacheMiss: 1 })
  })

  it('ignores rounds without usage instead of counting them as zero', () => {
    const first = addUsageNumbers(null, { prompt: 10, completion: 2, total: 12, cacheHit: 0, cacheMiss: 0 })
    expect(addUsageNumbers(first, null)).toEqual(first)
    expect(addUsageNumbers(null, null)).toBeNull()
  })
})
