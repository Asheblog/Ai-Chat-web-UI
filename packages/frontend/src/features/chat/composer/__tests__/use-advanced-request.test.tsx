import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAdvancedRequest } from '../use-advanced-request'

describe('useAdvancedRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('loads cached custom payloads for session', () => {
    localStorage.setItem(
      'aichat:custom-request:1',
      JSON.stringify({
        body: '{"foo":"bar"}',
        headers: [{ name: 'X-Test', value: 'demo' }],
      }),
    )

    const { result } = renderHook(() => useAdvancedRequest({ sessionId: 1 }))

    expect(result.current.customBodyInput).toBe('{"foo":"bar"}')
    expect(result.current.customHeaders).toEqual([{ name: 'X-Test', value: 'demo' }])
  })

  it('persists changes to localStorage', () => {
    const { result } = renderHook(() => useAdvancedRequest({ sessionId: 2 }))

    act(() => {
      result.current.setCustomBodyInput('{"hello":"world"}')
    })
    act(() => {
      result.current.setCustomHeaders([{ name: 'Alpha', value: '1' }])
    })

    const stored = JSON.parse(localStorage.getItem('aichat:custom-request:2') || '{}')
    expect(stored.body).toBe('{"hello":"world"}')
    expect(stored.headers).toEqual([{ name: 'Alpha', value: '1' }])
  })
})
