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
  it('enforces header limit when adding new entry', () => {
    const { result } = renderHook(() => useAdvancedRequest({ sessionId: 3, maxHeaders: 1 }))

    act(() => {
      result.current.setCustomHeaders([{ name: 'Init', value: '1' }])
    })

    const appended = result.current.addCustomHeader()
    expect(appended.ok).toBe(false)
    expect(appended.reason).toContain('最多添加')
  })

  it('builds sanitized payloads and rejects invalid JSON', () => {
    const { result } = renderHook(() => useAdvancedRequest({ sessionId: 4 }))

    act(() => {
      result.current.setCustomBodyInput('not-json')
    })

    const invalid = result.current.buildRequestPayload()
    expect(invalid.ok).toBe(false)

    act(() => {
      result.current.setCustomBodyInput('{\"foo\":123}')
      result.current.setCustomHeaders([{ name: 'X-Test', value: 'ok' }])
    })

    const valid = result.current.buildRequestPayload()
    expect(valid.ok).toBe(true)
    if (valid.ok) {
      expect(valid.customBody).toEqual({ foo: 123 })
      expect(valid.customHeaders).toEqual([{ name: 'X-Test', value: 'ok' }])
    }
  })
})
