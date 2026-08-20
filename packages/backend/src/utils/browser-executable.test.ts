import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  isSystemBrowserFallbackPath,
  resolveBrowserExecutablePath,
} from './browser-executable'

describe('resolveBrowserExecutablePath', () => {
  const originalEnv = { ...process.env }
  let tempDir: string
  let playwrightBrowser: string
  let systemChromium: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-browser-path-'))
    playwrightBrowser = path.join(tempDir, 'ms-playwright', 'chrome')
    systemChromium = path.join(tempDir, 'usr-bin-chromium')
    fs.mkdirSync(path.dirname(playwrightBrowser), { recursive: true })
    fs.writeFileSync(playwrightBrowser, 'fake-playwright-chrome')
    fs.writeFileSync(systemChromium, 'fake-system-chromium')

    delete process.env.DEEP_RESEARCH_PDF_CHROMIUM_EXECUTABLE
    delete process.env.URL_READER_BROWSER_EXECUTABLE_PATH
    delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    delete process.env.CHROME_PATH
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('honors an explicit non-system executable path', () => {
    const explicit = path.join(tempDir, 'custom-chrome')
    fs.writeFileSync(explicit, 'custom')
    const resolved = resolveBrowserExecutablePath({
      explicitPath: explicit,
      playwrightExecutablePath: playwrightBrowser,
      systemCandidates: [systemChromium],
    })
    expect(resolved).toBe(explicit)
  })

  it('prefers playwright-managed browser over system chromium even when env points at system path', () => {
    process.env.URL_READER_BROWSER_EXECUTABLE_PATH = systemChromium
    const resolved = resolveBrowserExecutablePath({
      playwrightExecutablePath: playwrightBrowser,
      systemCandidates: [systemChromium],
    })
    expect(resolved).toBe(playwrightBrowser)
  })

  it('falls back to system chromium when playwright browser is unavailable', () => {
    process.env.URL_READER_BROWSER_EXECUTABLE_PATH = systemChromium
    const resolved = resolveBrowserExecutablePath({
      playwrightExecutablePath: path.join(tempDir, 'missing-playwright'),
      systemCandidates: [systemChromium],
    })
    expect(resolved).toBe(systemChromium)
  })

  it('marks default linux chromium paths as system fallbacks', () => {
    expect(isSystemBrowserFallbackPath('/usr/bin/chromium')).toBe(true)
    expect(isSystemBrowserFallbackPath('/usr/bin/google-chrome-stable')).toBe(true)
    expect(isSystemBrowserFallbackPath(playwrightBrowser)).toBe(false)
  })
})
