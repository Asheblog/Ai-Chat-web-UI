import React from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MessageAvatar } from '../message-avatar'

type ProbeStatus = 'loaded' | 'error' | 'loading'

/**
 * 替换 window.Image，模拟 Radix Avatar 的探测图：
 * Radix 在设置 src 后同步读取 complete / naturalWidth 决定 loaded/error/loading。
 */
const stubProbeImage = (status: ProbeStatus) => {
  const original = window.Image
  class FakeImage {
    complete = status !== 'loading'
    naturalWidth = status === 'loaded' ? 16 : 0
    referrerPolicy = ''
    crossOrigin: string | null = null
    addEventListener() {}
    removeEventListener() {}
    set src(_value: string) {}
  }
  ;(window as unknown as { Image: unknown }).Image = FakeImage
  return () => {
    ;(window as unknown as { Image: unknown }).Image = original
  }
}

afterEach(() => {
  cleanup()
})

describe('MessageAvatar', () => {
  test('加载中：占位字母首帧可见，且没有任何元素被提前隐藏', () => {
    const restore = stubProbeImage('loading')
    try {
      const { container } = render(
        <MessageAvatar src="/chat-images/profiles/a.png" alt="AI 头像" fallback="A" />,
      )

      expect(screen.getByText('A')).toBeTruthy()
      expect(screen.queryByRole('img')).toBeNull()
      expect(container.querySelector('.opacity-0')).toBeNull()
    } finally {
      restore()
    }
  })

  test('加载完成：图片渲染出来，占位字母同帧消失', () => {
    const restore = stubProbeImage('loaded')
    try {
      render(<MessageAvatar src="/chat-images/profiles/a.png" alt="AI 头像" fallback="A" />)

      expect(screen.getByRole('img').getAttribute('src')).toBe('/chat-images/profiles/a.png')
      expect(screen.queryByText('A')).toBeNull()
    } finally {
      restore()
    }
  })

  test('没有 src：只渲染占位字母', () => {
    const restore = stubProbeImage('loaded')
    try {
      render(<MessageAvatar src={null} alt="AI 头像" fallback="A" />)

      expect(screen.getByText('A')).toBeTruthy()
      expect(screen.queryByRole('img')).toBeNull()
    } finally {
      restore()
    }
  })

  test('加载失败：保留占位字母', () => {
    const restore = stubProbeImage('error')
    try {
      render(<MessageAvatar src="/chat-images/profiles/broken.png" alt="AI 头像" fallback="A" />)

      expect(screen.getByText('A')).toBeTruthy()
      expect(screen.queryByRole('img')).toBeNull()
    } finally {
      restore()
    }
  })
})
