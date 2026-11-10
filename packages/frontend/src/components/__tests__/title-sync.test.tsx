import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TitleSync } from '@/components/title-sync'
import { resetSharedBrandingControllerForTests } from '@/components/title-sync-controller'

const authMock = vi.hoisted(() => ({
  actorState: 'authenticated' as 'authenticated' | 'anonymous' | 'loading',
  fetchActor: vi.fn().mockResolvedValue(undefined),
}))

const settingsMock = vi.hoisted(() => ({
  brandText: null as string | null,
  fetchPublicBranding: vi.fn(),
  bootstrapBrandText: vi.fn(),
}))

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (state: typeof authMock) => unknown) => selector(authMock),
}))

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      systemSettings: null,
      publicBrandText: settingsMock.brandText,
      fetchPublicBranding: settingsMock.fetchPublicBranding,
      bootstrapBrandText: settingsMock.bootstrapBrandText,
    }),
}))

describe('TitleSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetSharedBrandingControllerForTests()
    settingsMock.brandText = null
    settingsMock.fetchPublicBranding.mockReset()
    settingsMock.fetchPublicBranding.mockResolvedValue(false)
    settingsMock.bootstrapBrandText.mockReset()
    authMock.actorState = 'authenticated'
    authMock.fetchActor.mockClear()
    document.title = ''
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('挂载即向服务端校验身份，不依赖持久化的 actorState', async () => {
    authMock.actorState = 'authenticated'
    render(<TitleSync initialBrandText="AIChat" initialBrandFallback />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(authMock.fetchActor).toHaveBeenCalledTimes(1)
  })

  it('匿名快照同样以服务端结果为准', async () => {
    authMock.actorState = 'anonymous'
    render(<TitleSync initialBrandText="AIChat" initialBrandFallback />)

    await act(async () => {
      await Promise.resolve()
    })

    expect(authMock.fetchActor).toHaveBeenCalledTimes(1)
  })

  it('StrictMode 双挂载只发起一次品牌请求', async () => {
    render(
      <React.StrictMode>
        <TitleSync initialBrandText="AIChat" initialBrandFallback />
      </React.StrictMode>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(1)
  })

  it('失败后有限退避重试，成功后停止；卸载清除定时器', async () => {
    settingsMock.fetchPublicBranding
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const view = render(<TitleSync initialBrandText="AIChat" initialBrandFallback />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(3)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000)
    })
    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(3)

    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('online 恢复事件在成功停止后重新拉取品牌', async () => {
    settingsMock.fetchPublicBranding.mockResolvedValue(true)
    render(<TitleSync initialBrandText="AIChat" initialBrandFallback />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(2)
  })

  it('身份切换后重新拉取品牌，loading 首次就绪不重复请求', async () => {
    settingsMock.fetchPublicBranding.mockResolvedValue(true)
    authMock.actorState = 'authenticated'
    const view = render(<TitleSync initialBrandText="AIChat" initialBrandFallback />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(1)

    authMock.actorState = 'anonymous'
    view.rerender(<TitleSync initialBrandText="AIChat" initialBrandFallback />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(settingsMock.fetchPublicBranding).toHaveBeenCalledTimes(2)
  })

  it('管理员修改系统品牌后标题立即跟随 store，无需额外请求', async () => {
    settingsMock.brandText = 'AIChat'
    settingsMock.fetchPublicBranding.mockResolvedValue(true)
    const view = render(<TitleSync initialBrandText="AIChat" />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.title).toBe('AIChat')
    expect(settingsMock.fetchPublicBranding).not.toHaveBeenCalled()

    settingsMock.brandText = 'MyBrand'
    view.rerender(<TitleSync initialBrandText="AIChat" />)
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.title).toBe('MyBrand')
    expect(settingsMock.fetchPublicBranding).not.toHaveBeenCalled()
  })
})
