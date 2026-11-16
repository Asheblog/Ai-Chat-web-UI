import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import {
  getSharedBrowserStats,
  resetSharedBrowserForTests,
  shutdownSharedBrowser,
  withSharedBrowserPage,
} from '../browser/pool'

// 真实 Chromium 生命周期 smoke：默认跳过，设置 URL_READER_REAL_BROWSER_SMOKE=1 时运行。
const enabled = process.env.URL_READER_REAL_BROWSER_SMOKE === '1'
const maybe = enabled ? test : test.skip

jest.setTimeout(90_000)

describe('shared browser live smoke', () => {
  beforeAll(async () => {
    await resetSharedBrowserForTests()
    process.env.URL_READER_BROWSER_IDLE_MS = '1000'
  })

  afterAll(async () => {
    await shutdownSharedBrowser()
    await resetSharedBrowserForTests()
    delete process.env.URL_READER_BROWSER_IDLE_MS
  })

  maybe('reuses one real Chromium, closes contexts, and reclaims idle', async () => {
    const candidates = [
      process.env.URL_READER_SMOKE_EXECUTABLE_PATH,
      chromium.executablePath(),
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ].filter((value): value is string => Boolean(value))
    const executablePath = candidates.find((candidate) => existsSync(candidate))
    expect(typeof executablePath).toBe('string')

    const first = await withSharedBrowserPage({ executablePath, purpose: 'read' }, async (page) => {
      await page.setContent?.('<html><body><article><h1>真实浏览器</h1><p>第一段正文用于验证 setContent 渲染。</p></article></body></html>')
      return page.content()
    })
    expect(first).toContain('真实浏览器')

    const second = await withSharedBrowserPage({ executablePath, purpose: 'read' }, async (page) => {
      await page.setContent?.('<html><body><article><p>第二次读取复用同一个 Chromium 进程。</p></article></body></html>')
      return page.content()
    })
    expect(second).toContain('第二次读取')

    expect(getSharedBrowserStats()).toMatchObject({
      launched: 1,
      contextsOpened: 2,
      contextsClosed: 2,
    })
    expect(getSharedBrowserStats().connected).toBe(true)

    // idle 1000ms 后应关闭真实浏览器进程。
    await new Promise((resolve) => setTimeout(resolve, 1400))
    expect(getSharedBrowserStats()).toMatchObject({ connected: false, idleCloses: 1 })

    await withSharedBrowserPage({ executablePath, purpose: 'read' }, async (page) => {
      await page.setContent?.('<html><body><p>idle 关闭后重新启动。</p></body></html>')
      return page.content()
    })
    expect(getSharedBrowserStats().launched).toBe(2)
  })
})
