import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const STORAGE_KEY = 'settings-storage'

const writeLegacySnapshot = (state: Record<string, unknown>) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }))
}

describe('settings-store persist 迁移', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('rehydrate 剥掉已迁到账号的上下文开关，保留 sidebarCollapsed', async () => {
    const { useSettingsStore } = await import('@/store/settings-store')
    useSettingsStore.setState({ sidebarCollapsed: false })
    writeLegacySnapshot({
      contextEnabled: false,
      newConversationContextEnabled: true,
      sidebarCollapsed: true,
    })

    await useSettingsStore.persist.rehydrate()

    const state = useSettingsStore.getState() as unknown as Record<string, unknown>
    expect(state.sidebarCollapsed).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(state, 'contextEnabled')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(state, 'newConversationContextEnabled')).toBe(false)
  })

  it('persist 落 assistantAvatarUrl，systemSettings 不落盘', async () => {
    const { useSettingsStore } = await import('@/store/settings-store')
    const avatarUrl = '/chat-images/profiles/2026/11/14/a.png'
    useSettingsStore.setState({ assistantAvatarUrl: avatarUrl })
    useSettingsStore.setState({
      systemSettings: { assistantAvatarUrl: avatarUrl } as never,
    })

    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')

    expect(raw.state.assistantAvatarUrl).toBe(avatarUrl)
    expect(raw.state.systemSettings).toBeUndefined()
  })

  it('rehydrate 恢复 assistantAvatarUrl，首帧就有可用 src', async () => {
    const { useSettingsStore } = await import('@/store/settings-store')
    const avatarUrl = '/chat-images/profiles/2026/11/14/b.png'
    useSettingsStore.setState({ assistantAvatarUrl: null })
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { sidebarCollapsed: false, assistantAvatarUrl: avatarUrl }, version: 2 }),
    )

    await useSettingsStore.persist.rehydrate()

    expect(useSettingsStore.getState().assistantAvatarUrl).toBe(avatarUrl)
  })
})
