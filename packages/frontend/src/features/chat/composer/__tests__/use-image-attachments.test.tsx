import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useImageAttachments } from '../use-image-attachments'
import type { ComposerImage } from '../types'
import type { ChangeEvent } from 'react'

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

  it('allows adding images when vision disabled but vision proxy enabled', async () => {
    const toast = vi.fn()
    const { result } = renderHook(() =>
      useImageAttachments({
        isVisionEnabled: false,
        visionProxyEnabled: true,
        limits,
        toast,
      }),
    )

    // jsdom 不解析真实图片，mock FileReader 与 Image 使校验同步完成
    class MockFileReader {
      result: string | null = null
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() {
        this.result = 'data:image/png;base64,AAAA'
        this.onload?.()
      }
    }
    class MockImage {
      naturalWidth = 800
      naturalHeight = 600
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        this.onload?.()
      }
    }
    vi.stubGlobal('FileReader', MockFileReader)
    vi.stubGlobal('Image', MockImage)

    try {
      const file = new File(['fake-png'], 'test.png', { type: 'image/png' })
      const event = { target: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>

      await act(async () => {
        await result.current.onFilesSelected(event)
      })

      expect(result.current.selectedImages).toHaveLength(1)
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('clears images only when both vision and proxy disabled', () => {
    const toast = vi.fn()
    const { result, rerender } = renderHook(
      ({ isVisionEnabled, visionProxyEnabled }) =>
        useImageAttachments({
          isVisionEnabled,
          visionProxyEnabled,
          limits,
          toast,
        }),
      { initialProps: { isVisionEnabled: true, visionProxyEnabled: false } },
    )

    const mockImage: ComposerImage = {
      dataUrl: 'data:image/png;base64,AAAA',
      mime: 'image/png',
      size: 128,
    }

    act(() => {
      result.current.setSelectedImages([mockImage])
    })
    rerender({ isVisionEnabled: false, visionProxyEnabled: true })
    expect(result.current.selectedImages).toHaveLength(1)

    rerender({ isVisionEnabled: false, visionProxyEnabled: false })
    expect(result.current.selectedImages).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '已清空图片' }),
    )
  })
})
