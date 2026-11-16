import { assessBrowserMemory, readMemorySnapshot } from '../browser/memory'

const MiB = 1024 * 1024

const reader = (files: Record<string, string>) => async (path: string): Promise<string> => {
  const value = files[path]
  if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  return value
}

describe('readMemorySnapshot', () => {
  test('reads cgroup v2 current and max', async () => {
    const snapshot = await readMemorySnapshot({
      readFile: reader({
        '/sys/fs/cgroup/memory.current': String(300 * MiB),
        '/sys/fs/cgroup/memory.max': String(1024 * MiB),
      }),
    })
    expect(snapshot).toMatchObject({
      signal: 'cgroup-v2',
      usageBytes: 300 * MiB,
      limitBytes: 1024 * MiB,
      headroomBytes: 724 * MiB,
      advisory: true,
    })
  })

  test('falls back to cgroup v1 when v2 is unavailable', async () => {
    const snapshot = await readMemorySnapshot({
      readFile: reader({
        '/sys/fs/cgroup/memory/memory.usage_in_bytes': String(200 * MiB),
        '/sys/fs/cgroup/memory/memory.limit_in_bytes': String(768 * MiB),
      }),
    })
    expect(snapshot).toMatchObject({ signal: 'cgroup-v1', usageBytes: 200 * MiB, limitBytes: 768 * MiB })
  })

  test('treats an unlimited cgroup max as unknown limit and uses freemem only for headroom', async () => {
    const snapshot = await readMemorySnapshot({
      readFile: reader({
        '/sys/fs/cgroup/memory.current': String(100 * MiB),
        '/sys/fs/cgroup/memory.max': 'max',
      }),
      freemem: () => 1500 * MiB,
    })
    expect(snapshot.signal).toBe('cgroup-v2')
    expect(snapshot.limitBytes).toBeUndefined()
    expect(snapshot.headroomBytes).toBe(1500 * MiB)
    expect(snapshot.advisory).toBe(true)
  })

  test('falls back to os-level freemem without claiming a container limit', async () => {
    const snapshot = await readMemorySnapshot({
      readFile: reader({}),
      freemem: () => 900 * MiB,
    })
    expect(snapshot).toMatchObject({ signal: 'freemem', headroomBytes: 900 * MiB, advisory: true })
    expect(snapshot.limitBytes).toBeUndefined()
  })
})

describe('assessBrowserMemory', () => {
  test('allows a container with plenty of headroom', async () => {
    const verdict = await assessBrowserMemory({
      readFile: reader({
        '/sys/fs/cgroup/memory.current': String(200 * MiB),
        '/sys/fs/cgroup/memory.max': String(2048 * MiB),
      }),
    })
    expect(verdict).toMatchObject({ allowed: true, advisory: true })
  })

  test('skips rendering when container headroom is below 256 MiB', async () => {
    const verdict = await assessBrowserMemory({
      readFile: reader({
        '/sys/fs/cgroup/memory.current': String(900 * MiB),
        '/sys/fs/cgroup/memory.max': String(1024 * MiB),
      }),
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('low-headroom')
  })

  test('skips rendering when the container limit is below 768 MiB', async () => {
    const verdict = await assessBrowserMemory({
      readFile: reader({
        '/sys/fs/cgroup/memory/memory.usage_in_bytes': String(100 * MiB),
        '/sys/fs/cgroup/memory/memory.limit_in_bytes': String(512 * MiB),
      }),
    })
    expect(verdict).toMatchObject({ allowed: false, reason: 'low-container-limit' })
  })

  test('honours env overrides for headroom and container limit', async () => {
    const readFile = reader({
      '/sys/fs/cgroup/memory.current': String(900 * MiB),
      '/sys/fs/cgroup/memory.max': String(1024 * MiB),
    })
    const relaxed = await assessBrowserMemory({
      readFile,
      env: {
        URL_READER_BROWSER_MIN_HEADROOM_MB: '64',
        URL_READER_BROWSER_MIN_CONTAINER_LIMIT_MB: '512',
      },
    })
    expect(relaxed.allowed).toBe(true)
  })

  test('can be disabled explicitly', async () => {
    const verdict = await assessBrowserMemory({
      readFile: reader({}),
      env: { URL_READER_BROWSER_MEMORY_CHECK: 'off' },
    })
    expect(verdict).toMatchObject({ allowed: true, reason: 'disabled' })
  })

  test('marks low memory as advisory rather than a hard memory cap', async () => {
    const verdict = await assessBrowserMemory({
      readFile: reader({
        '/sys/fs/cgroup/memory.current': String(900 * MiB),
        '/sys/fs/cgroup/memory.max': String(1024 * MiB),
      }),
    })
    expect(verdict.advisory).toBe(true)
    expect(verdict.snapshot.signal).toBe('cgroup-v2')
    expect(verdict.minHeadroomBytes).toBe(256 * MiB)
    expect(verdict.minContainerLimitBytes).toBe(768 * MiB)
  })
})