import {
  AUTH_TOKEN_TTL_SECONDS,
  resolveTokenTtlSeconds,
  shouldRenewAuthToken,
} from '../auth'

describe('resolveTokenTtlSeconds', () => {
  it('falls back to 24h when unset', () => {
    expect(resolveTokenTtlSeconds(undefined)).toBe(24 * 60 * 60)
    expect(AUTH_TOKEN_TTL_SECONDS).toBeGreaterThanOrEqual(60)
  })

  it('honours a valid override', () => {
    expect(resolveTokenTtlSeconds('2592000')).toBe(2592000)
  })

  it('rejects garbage and clamps the range', () => {
    expect(resolveTokenTtlSeconds('abc')).toBe(24 * 60 * 60)
    expect(resolveTokenTtlSeconds('')).toBe(24 * 60 * 60)
    expect(resolveTokenTtlSeconds('-1')).toBe(24 * 60 * 60)
    expect(resolveTokenTtlSeconds('0')).toBe(24 * 60 * 60)
    expect(resolveTokenTtlSeconds('10')).toBe(60)
    expect(resolveTokenTtlSeconds(String(400 * 24 * 60 * 60))).toBe(365 * 24 * 60 * 60)
  })
})

describe('shouldRenewAuthToken', () => {
  const now = 1_700_000_000
  const ttl = 24 * 60 * 60

  it('does not renew while more than half of the TTL remains', () => {
    expect(shouldRenewAuthToken({ exp: now + 20 * 60 * 60 }, now, ttl)).toBe(false)
  })

  it('renews once the remaining lifetime drops below half of the TTL', () => {
    expect(shouldRenewAuthToken({ exp: now + 60 * 60 }, now, ttl)).toBe(true)
    expect(shouldRenewAuthToken({ exp: now - 1 }, now, ttl)).toBe(true)
  })

  it('falls back to iat when the payload has no exp', () => {
    expect(shouldRenewAuthToken({ iat: now - 60 * 60 }, now, ttl)).toBe(false)
    expect(shouldRenewAuthToken({ iat: now - 13 * 60 * 60 }, now, ttl)).toBe(true)
  })

  it('renews payloads that carry neither exp nor iat', () => {
    expect(shouldRenewAuthToken({}, now, ttl)).toBe(true)
    expect(shouldRenewAuthToken(null, now, ttl)).toBe(true)
  })
})
