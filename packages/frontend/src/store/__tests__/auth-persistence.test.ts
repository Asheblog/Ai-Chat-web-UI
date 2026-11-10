import { describe, expect, it } from 'vitest'
import { mergePersistedAuthState } from '@/store/auth-persistence'

const createCurrent = () => ({
  actor: null,
  user: null,
  quota: null,
  actorState: 'loading' as 'loading' | 'anonymous' | 'authenticated',
  isLoading: false,
  error: null as string | null,
})

describe('mergePersistedAuthState', () => {
  it('restores the first-paint snapshot', () => {
    const merged = mergePersistedAuthState(
      {
        actor: { type: 'user', id: 1 },
        user: { id: 1, username: 'alice' },
        quota: { remaining: 10 },
      },
      createCurrent(),
    )

    expect(merged.actor).toEqual({ type: 'user', id: 1 })
    expect(merged.user).toEqual({ id: 1, username: 'alice' })
    expect(merged.quota).toEqual({ remaining: 10 })
  })

  it('drops a stale actorState so an expired cookie cannot look logged in', () => {
    const merged = mergePersistedAuthState(
      { actorState: 'authenticated', actor: { type: 'user', id: 1 } },
      createCurrent(),
    )

    expect(merged.actorState).toBe('loading')
    expect(merged.actor).toEqual({ type: 'user', id: 1 })
  })

  it('falls back to an empty snapshot for malformed storage', () => {
    expect(mergePersistedAuthState(null, createCurrent()).actor).toBeNull()
    expect(mergePersistedAuthState('oops', createCurrent()).user).toBeNull()
    expect(mergePersistedAuthState({ actor: undefined }, createCurrent()).actor).toBeNull()
  })
})
