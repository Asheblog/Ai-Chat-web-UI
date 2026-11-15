import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/components/app-shell'

const shell = <AppShell ready sidebar={null} toolbar={null}><textarea aria-label="消息" /></AppShell>
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('聊天可视视口', () => {
  it('键盘缩小视口和焦点滚动时发布可见高度、顶部和遮挡量，关闭后恢复', () => {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
    vi.stubGlobal('visualViewport', viewport)
    vi.stubGlobal('innerHeight', 844)
    const { unmount } = render(shell)
    const style = document.documentElement.style
    expect(style.getPropertyValue('--app-visible-height')).toBe('844px')
    act(() => { viewport.height = 480; viewport.offsetTop = 32; viewport.dispatchEvent(new Event('resize')) })
    expect(style.getPropertyValue('--app-visible-height')).toBe('480px')
    expect(style.getPropertyValue('--app-viewport-offset-top')).toBe('32px')
    expect(style.getPropertyValue('--app-keyboard-inset')).toBe('332px')
    act(() => { viewport.offsetTop = 50; viewport.dispatchEvent(new Event('scroll')) })
    expect(style.getPropertyValue('--app-keyboard-inset')).toBe('314px')
    act(() => { viewport.height = 844; viewport.offsetTop = 0; viewport.dispatchEvent(new Event('resize')) })
    expect(style.getPropertyValue('--app-keyboard-inset')).toBe('0px')
    unmount()
    expect(style.getPropertyValue('--app-visible-height')).toBe('')
    act(() => { viewport.height = 200; viewport.dispatchEvent(new Event('resize')) })
    expect(style.getPropertyValue('--app-visible-height')).toBe('')
  })

  it('无 VisualViewport 时跟随窗口 resize，捏合缩放不缩小聊天壳', () => {
    vi.stubGlobal('visualViewport', undefined)
    vi.stubGlobal('innerHeight', 600)
    render(shell)
    expect(document.documentElement.style.getPropertyValue('--app-visible-height')).toBe('600px')
    act(() => { vi.stubGlobal('innerHeight', 375); window.dispatchEvent(new Event('resize')) })
    expect(document.documentElement.style.getPropertyValue('--app-visible-height')).toBe('375px')
  })

  it('保留捏合缩放前尺寸，避免缩放时输入区和字形反向重排', () => {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 })
    vi.stubGlobal('visualViewport', viewport)
    vi.stubGlobal('innerHeight', 844)
    render(shell)
    act(() => { viewport.height = 422; viewport.scale = 2; viewport.dispatchEvent(new Event('resize')) })
    expect(document.documentElement.style.getPropertyValue('--app-visible-height')).toBe('844px')
  })
})
