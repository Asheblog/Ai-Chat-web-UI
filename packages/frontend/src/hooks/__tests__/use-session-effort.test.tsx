import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useComposerFeatureFlags } from '@/features/chat/composer/use-composer-feature-flags'
import type { ChatSession } from '@/types'

describe('会话强度水合', () => {
  it('系统 medium 下用户选择 unset 在同会话刷新后保持，切会话重新水合', () => {
    const { result, rerender } = renderHook(({ id, saved }) => useComposerFeatureFlags({
      currentSession: { id, reasoningEffort: saved } as ChatSession,
      systemSettings: { openaiReasoningEffort: 'medium' } as Parameters<typeof useComposerFeatureFlags>[0]['systemSettings'],
      activeModel: null, isAdmin: false,
      persistWebSearchPreference: vi.fn(), persistPythonPreference: vi.fn(), persistDeepResearchPreference: vi.fn(),
    }), { initialProps: { id: 1, saved: undefined as string | null | undefined } })
    expect(result.current.effort).toBe('medium')
    act(() => result.current.setEffort('unset'))
    rerender({ id: 1, saved: undefined })
    expect(result.current.effort).toBe('unset')
    rerender({ id: 2, saved: 'high' })
    expect(result.current.effort).toBe('high')
    rerender({ id: 1, saved: null })
    expect(result.current.effort).toBe('unset')
  })
})
