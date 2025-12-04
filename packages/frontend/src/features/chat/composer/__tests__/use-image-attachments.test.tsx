import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useImageAttachments } from '../use-image-attachments'
import type { ComposerImage } from '../types'

const limits = {
  maxCount: 5,
  maxMb: 4,
  maxEdge: 1024,
  maxTotalMb: 10,
}

describe('useImageAttachments', () => {
  it('clears images when vision support is disabled', () => {
    const toast = vi.fn()
    const { result, rerender } = renderHook(
      ({ isVisionEnabled }) =>
        useImageAttachments({
          isVisionEnabled,
          limits,
          toast,
        }),
      { initialProps: { isVisionEnabled: true } },
    )

    const mockImage: ComposerImage = {
      dataUrl: 'data:image/png;base64,AAAA',
      mime: 'image/png',
      size: 128,
    }

    act(() => {
      result.current.setSelectedImages([mockImage])
    })
    rerender({ isVisionEnabled: false })

    expect(result.current.selectedImages).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '已清空图片' }),
    )
  })

  it('blocks pickImages when vision is disabled', () => {
    const toast = vi.fn()
    const { result } = renderHook(() =>
      useImageAttachments({
        isVisionEnabled: false,
        limits,
        toast,
      }),
    )

    act(() => {
      result.current.pickImages()
    })

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '当前模型不支持图片' }),
    )
  })
})
