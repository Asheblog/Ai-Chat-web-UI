import { describe, expect, it } from 'vitest'
import { shouldRedirectToLogin } from '@/lib/api'

describe('shouldRedirectToLogin', () => {
  it('stays put on the login/register pages to avoid a reload loop', () => {
    expect(shouldRedirectToLogin('/auth/login')).toBe(false)
    expect(shouldRedirectToLogin('/auth/register')).toBe(false)
  })

  it('redirects every other route to the login page', () => {
    expect(shouldRedirectToLogin('/main')).toBe(true)
    expect(shouldRedirectToLogin('/main/12')).toBe(true)
    expect(shouldRedirectToLogin('/share/abc')).toBe(true)
  })
})
