/**
 * 浏览器渲染前的内存余量判断。
 *
 * 读取 cgroup v1/v2 的容器用量与上限；读不到时退回 os.freemem。
 * 这是“是否值得冒内存峰值风险”的建议信号，不是硬性内存上限：
 * 渲染期间没有 cgroup 级别的额外限制，结果始终标记 advisory。
 */

import os from 'node:os'

const MiB = 1024 * 1024
const CGROUP_V2_CURRENT = '/sys/fs/cgroup/memory.current'
const CGROUP_V2_MAX = '/sys/fs/cgroup/memory.max'
const CGROUP_V1_USAGE = '/sys/fs/cgroup/memory/memory.usage_in_bytes'
const CGROUP_V1_LIMIT = '/sys/fs/cgroup/memory/memory.limit_in_bytes'
const UNLIMITED_SENTINEL = 2 ** 50

export type MemorySignal = 'cgroup-v2' | 'cgroup-v1' | 'freemem'

export interface BrowserMemorySnapshot {
  signal: MemorySignal
  usageBytes?: number
  limitBytes?: number
  headroomBytes: number
  advisory: true
}

export interface MemoryProbeOptions {
  readFile?: (path: string) => Promise<string>
  freemem?: () => number
}

export type MemorySkipReason = 'low-headroom' | 'low-container-limit' | 'disabled'

export interface BrowserMemoryAssessment {
  allowed: boolean
  reason?: MemorySkipReason
  advisory: true
  snapshot: BrowserMemorySnapshot
  minHeadroomBytes: number
  minContainerLimitBytes: number
}

export interface AssessBrowserMemoryOptions extends MemoryProbeOptions {
  env?: NodeJS.ProcessEnv
}

const defaultReadFile = async (path: string): Promise<string> => {
  const fs = await import('node:fs/promises')
  return fs.readFile(path, 'utf8')
}

const parseBytes = (value: string | undefined): number | undefined => {
  const raw = (value || '').trim()
  if (!raw || raw === 'max') return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  // cgroup v1 reports a huge sentinel instead of 'max' for unlimited containers.
  if (parsed >= UNLIMITED_SENTINEL) return undefined
  return parsed
}

const tryRead = async (
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<string | undefined> => {
  try {
    return await readFile(path)
  } catch {
    return undefined
  }
}

export async function readMemorySnapshot(options: MemoryProbeOptions = {}): Promise<BrowserMemorySnapshot> {
  const readFile = options.readFile ?? defaultReadFile
  const freemem = options.freemem ?? (() => os.freemem())

  const v2Current = parseBytes(await tryRead(readFile, CGROUP_V2_CURRENT))
  if (v2Current !== undefined) {
    const v2Limit = parseBytes(await tryRead(readFile, CGROUP_V2_MAX))
    const headroomBytes = v2Limit !== undefined ? Math.max(0, v2Limit - v2Current) : Math.max(0, freemem())
    return {
      signal: 'cgroup-v2',
      usageBytes: v2Current,
      ...(v2Limit !== undefined ? { limitBytes: v2Limit } : {}),
      headroomBytes,
      advisory: true,
    }
  }

  const v1Usage = parseBytes(await tryRead(readFile, CGROUP_V1_USAGE))
  if (v1Usage !== undefined) {
    const v1Limit = parseBytes(await tryRead(readFile, CGROUP_V1_LIMIT))
    const headroomBytes = v1Limit !== undefined ? Math.max(0, v1Limit - v1Usage) : Math.max(0, freemem())
    return {
      signal: 'cgroup-v1',
      usageBytes: v1Usage,
      ...(v1Limit !== undefined ? { limitBytes: v1Limit } : {}),
      headroomBytes,
      advisory: true,
    }
  }

  const headroomBytes = Math.max(0, freemem())
  return {
    signal: 'freemem',
    headroomBytes,
    advisory: true,
  }
}

const parsePositiveMb = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt((value || '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export const DEFAULT_MIN_HEADROOM_MB = 256
export const DEFAULT_MIN_CONTAINER_LIMIT_MB = 768

export async function assessBrowserMemory(
  options: AssessBrowserMemoryOptions = {},
): Promise<BrowserMemoryAssessment> {
  const env = options.env ?? process.env
  const minHeadroomBytes = parsePositiveMb(env.URL_READER_BROWSER_MIN_HEADROOM_MB, DEFAULT_MIN_HEADROOM_MB) * MiB
  const minContainerLimitBytes =
    parsePositiveMb(env.URL_READER_BROWSER_MIN_CONTAINER_LIMIT_MB, DEFAULT_MIN_CONTAINER_LIMIT_MB) * MiB
  const snapshot = await readMemorySnapshot(options)
  const disabled = ['off', 'false', '0', 'no'].includes(
    (env.URL_READER_BROWSER_MEMORY_CHECK || '').trim().toLowerCase(),
  )

  if (disabled) {
    return {
      allowed: true,
      reason: 'disabled',
      advisory: true,
      snapshot,
      minHeadroomBytes,
      minContainerLimitBytes,
    }
  }

  const base = {
    advisory: true as const,
    snapshot,
    minHeadroomBytes,
    minContainerLimitBytes,
  }

  if (typeof snapshot.limitBytes === 'number' && snapshot.limitBytes < minContainerLimitBytes) {
    return { ...base, allowed: false, reason: 'low-container-limit' }
  }
  if (snapshot.headroomBytes < minHeadroomBytes) {
    return { ...base, allowed: false, reason: 'low-headroom' }
  }
  return { ...base, allowed: true }
}
