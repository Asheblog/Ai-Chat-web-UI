import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSingleModelBattleShare } from './useSingleModelBattleShare'

const mockToast = vi.fn()
const mockCreateBattleShare = vi.fn()
const mockWriteText = vi.fn()

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/features/battle/api', () => ({
  createBattleShare: (...args: any[]) => mockCreateBattleShare(...args),
}))

describe('useSingleModelBattleShare', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    })
  })

  it('generates and copies share link', async () => {
    mockCreateBattleShare.mockResolvedValue({
      success: true,
      data: { token: 'battle-token' },
    })

    const { result } = renderHook(() => useSingleModelBattleShare(123))

    await act(async () => {
      await result.current.handleShare()
    })

    expect(result.current.shareLink).toContain('/share/battle/battle-token')

    await act(async () => {
      await result.current.handleCopyShareLink()
    })

    expect(mockWriteText).toHaveBeenCalledWith(result.current.shareLink)
    expect(result.current.copiedShareLink).toBe(true)
  })
})
