import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestMarkdownRender, shutdownMarkdownWorker } from '@/lib/markdown-worker-client'

class MockWorker {
  static instances: MockWorker[] = []

  readonly posted: any[] = []
  private readonly listeners: {
    message: Array<(event: MessageEvent<any>) => void>
    error: Array<(event: ErrorEvent) => void>
  } = {
    message: [],
    error: [],
  }

  constructor(..._args: any[]) {
    MockWorker.instances.push(this)
  }

  addEventListener(type: 'message' | 'error', listener: any) {
    this.listeners[type].push(listener)
  }

  postMessage(payload: any) {
    this.posted.push(payload)
    setTimeout(() => {
      this.listeners.message.forEach((listener) =>
        listener({
          data: {
            jobId: payload.jobId,
            messageId: payload.messageId,
            contentHtml: '<p>ok</p>',
            reasoningHtml: null,
            contentVersion: payload.contentVersion,
            reasoningVersion: payload.reasoningVersion,
          },
        } as MessageEvent<any>),
      )
    }, 0)
  }

  terminate() {}
}

describe('markdown-worker-client', () => {
  beforeEach(() => {
    MockWorker.instances = []
    ;(globalThis as any).Worker = MockWorker
  })

  afterEach(() => {
    shutdownMarkdownWorker()
    vi.unstubAllGlobals()
  })

  it('sends numeric messageId to worker as string', async () => {
    const result = await requestMarkdownRender({
      messageId: 123,
      content: '# title',
      contentVersion: 2,
      reasoningVersion: 0,
    })

    expect(result.contentHtml).toBe('<p>ok</p>')
    expect(MockWorker.instances).toHaveLength(1)
    expect(MockWorker.instances[0]?.posted).toHaveLength(1)
    expect(typeof MockWorker.instances[0]?.posted[0]?.messageId).toBe('string')
    expect(MockWorker.instances[0]?.posted[0]?.messageId).toBe('123')
  })
})
