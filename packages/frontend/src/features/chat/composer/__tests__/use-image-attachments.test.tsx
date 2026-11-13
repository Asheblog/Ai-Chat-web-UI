import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useImageAttachments } from '../use-image-attachments'
import type { ComposerImage } from '../types'
import type { ClipboardEvent } from 'react'

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

  it('rejects images when the model does not support vision', () => {
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

    expect(result.current.selectedImages).toEqual([])
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('blocks pasted images when the model does not support vision', async () => {
    const toast = vi.fn()
    const { result } = renderHook(() =>
      useImageAttachments({
        isVisionEnabled: false,
        limits,
        toast,
      }),
    )

    const preventDefault = vi.fn()
    const file = new File(['fake-png'], 'paste.png', { type: 'image/png' })
    const event = {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
      preventDefault,
    } as unknown as ClipboardEvent<HTMLTextAreaElement>

    await act(async () => {
      await result.current.handlePaste(event)
    })

    expect(result.current.selectedImages).toEqual([])
    expect(preventDefault).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('ignores the retired vision proxy option instead of granting attachments', () => {
    const toast = vi.fn()
    const legacyOptions = {
      isVisionEnabled: false,
      visionProxyEnabled: true,
      limits,
      toast,
    } as Parameters<typeof useImageAttachments>[0]
    const { result } = renderHook(() => useImageAttachments(legacyOptions))

    act(() => {
      result.current.pickImages()
    })

    expect(result.current.selectedImages).toEqual([])
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: '图片将自动转写' }))
  })
})
