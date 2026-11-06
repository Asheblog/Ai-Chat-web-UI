import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestMarkdownRender, shutdownMarkdownWorker } from '@/lib/markdown-worker-client'

class MockWorker {
  static instances: MockWorker[] = []
  posted: any[] = []
  terminated = false
  failPost = false
  listeners = new Map<string, Array<(event: any) => void>>()
  constructor() { MockWorker.instances.push(this) }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  emit(type: string, data: any = {}) {
    this.listeners.get(type)?.forEach((listener) => listener(type === 'message' ? { data } : data))
  }
  ready() { this.emit('message', { type: 'ready' }) }
  reply(index = 0) {
    this.emit('message', { ...this.posted[index], contentHtml: '<p>ok</p>' })
  }
  postMessage(payload: any) {
    if (this.failPost) throw new Error('post failed')
    this.posted.push(payload)
  }
  terminate() { this.terminated = true }
}

const payload = { messageId: 123, content: '# title', contentVersion: 2, reasoningVersion: 0 }

describe('markdown-worker-client lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWorker.instances = []
    vi.stubGlobal('Worker', MockWorker)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    shutdownMarkdownWorker()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('waits for ready and normalizes numeric message IDs', async () => {
    const result = requestMarkdownRender(payload)
    const worker = MockWorker.instances[0]
    expect(worker.posted).toHaveLength(0)
    worker.ready()
    expect(worker.posted[0].messageId).toBe('123')
    worker.reply()
    expect((await result).contentHtml).toBe('<p>ok</p>')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles all jobs when initialization never completes', async () => {
    const first = requestMarkdownRender(payload)
    const second = requestMarkdownRender({ ...payload, messageId: 456 })
    await vi.advanceTimersByTimeAsync(3000)
    expect((await first).errored).toBe(true)
    expect((await second).errored).toBe(true)
    expect(MockWorker.instances[0].terminated).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles jobs whose ready worker stops responding', async () => {
    const result = requestMarkdownRender(payload)
    MockWorker.instances[0].ready()
    await vi.advanceTimersByTimeAsync(5000)
    expect((await result).errored).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['error', 'messageerror'])('cleans up on %s and ignores stale messages', async (type) => {
    const result = requestMarkdownRender(payload)
    const worker = MockWorker.instances[0]
    worker.ready()
    worker.emit(type, { message: 'unavailable' })
    expect((await result).errored).toBe(true)
    worker.reply()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles synchronous postMessage failures', async () => {
    const result = requestMarkdownRender(payload)
    MockWorker.instances[0].failPost = true
    MockWorker.instances[0].ready()
    expect((await result).errored).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('limits consecutive restarts and permits explicit shutdown recovery', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = requestMarkdownRender(payload)
      const worker = MockWorker.instances[MockWorker.instances.length - 1]
      worker.emit('error')
      expect((await result).errored).toBe(true)
      await vi.advanceTimersByTimeAsync(10000)
    }
    expect((await requestMarkdownRender(payload)).errored).toBe(true)
    expect(MockWorker.instances).toHaveLength(3)
    shutdownMarkdownWorker()
    const recovered = requestMarkdownRender(payload)
    const worker = MockWorker.instances[MockWorker.instances.length - 1]
    worker.ready()
    worker.reply()
    expect((await recovered).contentHtml).toBe('<p>ok</p>')
  })

  it('cools down failures before creating another worker', async () => {
    const result = requestMarkdownRender(payload)
    MockWorker.instances[0].emit('error')
    await result
    expect((await requestMarkdownRender(payload)).errored).toBe(true)
    expect(MockWorker.instances).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10000)
    const recovered = requestMarkdownRender(payload)
    MockWorker.instances[1].ready()
    MockWorker.instances[1].reply()
    expect((await recovered).contentHtml).toBe('<p>ok</p>')
  })

  it('settles shutdown requests and clears initialization timers', async () => {
    const result = requestMarkdownRender(payload)
    shutdownMarkdownWorker()
    expect((await result).errored).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles superseded responses without accepting negative versions', async () => {
    const result = requestMarkdownRender(payload)
    const worker = MockWorker.instances[0]
    worker.ready()
    worker.emit('message', { ...worker.posted[0], contentVersion: -1, reasoningVersion: -1, contentHtml: '' })
    expect((await result).errored).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles construction failures without retaining timers', async () => {
    const construct = vi.fn(() => { throw new Error('blocked') })
    vi.stubGlobal('Worker', class { constructor() { construct() } })
    expect((await requestMarkdownRender(payload)).errored).toBe(true)
    await requestMarkdownRender(payload)
    expect(construct).toHaveBeenCalledTimes(1)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await vi.advanceTimersByTimeAsync(10000)
      await requestMarkdownRender(payload)
    }
    expect(construct).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('resets the failure budget after a successful render', async () => {
    for (let cycle = 0; cycle < 4; cycle += 1) {
      const failed = requestMarkdownRender(payload)
      MockWorker.instances.at(-1)!.emit('error')
      await failed
      await vi.advanceTimersByTimeAsync(10000)
      const success = requestMarkdownRender(payload)
      const worker = MockWorker.instances.at(-1)!
      worker.ready()
      worker.reply()
      expect((await success).errored).not.toBe(true)
    }
  })
})
