/**
 * Shared Chromium/Chrome/Edge executable resolution for URL reader and PDF export.
 *
 * Playwright-core is tightly coupled to its own Chromium revision. System
 * packages such as Debian `/usr/bin/chromium` often exist in containers but
 * fail CDP launch. Prefer Playwright-managed browsers whenever available;
 * treat common system paths as last-resort fallbacks even if env vars point
 * at them (1Panel compose historically defaults to `/usr/bin/chromium`).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

export const LINUX_SYSTEM_BROWSER_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/microsoft-edge',
  '/snap/bin/chromium',
] as const

const WSL_BROWSER_CANDIDATES = [
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
] as const

const SYSTEM_FALLBACK_BASENAMES = new Set([
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'microsoft-edge',
  'chrome.exe',
  'msedge.exe',
])

const pathExists = (candidate: string): boolean => {
  try {
    return existsSync(candidate)
  } catch {
    return false
  }
}

const windowsBrowserCandidates = (): string[] => {
  const roots = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ].filter(Boolean) as string[]
  return roots.flatMap((root) => [
    path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ])
}

export const isSystemBrowserFallbackPath = (candidate: string): boolean => {
  const normalized = candidate.replace(/\\/g, '/').toLowerCase()
  if (LINUX_SYSTEM_BROWSER_CANDIDATES.some((item) => item.toLowerCase() === normalized)) {
    return true
  }
  if (WSL_BROWSER_CANDIDATES.some((item) => item.toLowerCase() === normalized)) {
    return true
  }
  const base = path.basename(normalized)
  if (!SYSTEM_FALLBACK_BASENAMES.has(base)) return false
  // Playwright-managed browsers live under ms-playwright / chromium-* trees.
  if (normalized.includes('/ms-playwright/') || normalized.includes('/chromium-')) {
    return false
  }
  return (
    normalized.startsWith('/usr/bin/') ||
    normalized.startsWith('/snap/bin/') ||
    normalized.includes('/google/chrome/') ||
    normalized.includes('/microsoft/edge/')
  )
}

export const readPlaywrightChromiumExecutablePath = (
  chromiumLike?: { executablePath?: () => string },
): string | undefined => {
  try {
    const value = chromiumLike?.executablePath?.()
    const normalized = typeof value === 'string' ? value.trim() : ''
    return normalized || undefined
  } catch {
    return undefined
  }
}

export interface ResolveBrowserExecutablePathOptions {
  explicitPath?: string
  env?: NodeJS.ProcessEnv
  playwrightExecutablePath?: string
  systemCandidates?: readonly string[]
}

export const resolveBrowserExecutablePath = (
  options: ResolveBrowserExecutablePathOptions = {},
): string | undefined => {
  const env = options.env ?? process.env
  const systemCandidates = options.systemCandidates ?? [
    ...LINUX_SYSTEM_BROWSER_CANDIDATES,
    ...WSL_BROWSER_CANDIDATES,
    ...windowsBrowserCandidates(),
  ]
  const systemCandidateSet = new Set(
    systemCandidates.map((candidate) => candidate.replace(/\\/g, '/').toLowerCase()),
  )
  const isSystemPath = (candidate: string): boolean => {
    const normalized = candidate.replace(/\\/g, '/').toLowerCase()
    return isSystemBrowserFallbackPath(candidate) || systemCandidateSet.has(normalized)
  }

  const configured = [
    options.explicitPath,
    env.DEEP_RESEARCH_PDF_CHROMIUM_EXECUTABLE,
    env.URL_READER_BROWSER_EXECUTABLE_PATH,
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    env.CHROME_PATH,
  ]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)

  for (const candidate of configured) {
    if (!isSystemPath(candidate) && pathExists(candidate)) {
      return candidate
    }
  }

  const playwrightPath = (options.playwrightExecutablePath || '').trim()
  if (playwrightPath && pathExists(playwrightPath)) {
    return playwrightPath
  }

  for (const candidate of configured) {
    if (pathExists(candidate)) {
      return candidate
    }
  }

  for (const candidate of systemCandidates) {
    if (pathExists(candidate)) {
      return candidate
    }
  }

  return undefined
}
