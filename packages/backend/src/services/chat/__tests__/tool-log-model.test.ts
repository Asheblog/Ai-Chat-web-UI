import { resolveEventStatus } from '@aichat/shared/tool-events'
import { resolveToolLogStatus } from '../tool-log-model'

/**
 * T1：状态推断必须只有一份实现。
 * 这里直接与 shared 的 resolveEventStatus 对比，任何本地副本的分支顺序差异都会露出来。
 */
describe('工具事件状态推断单一实现', () => {
  const cases = [
    { status: 'running', stage: 'start' },
    { status: 'success', stage: 'result' },
    { status: 'aborted', stage: 'error' },
    { status: 'rejected', stage: 'start' },
    { stage: 'start', phase: 'pending_approval' },
    { stage: 'start', phase: 'result' },
    { stage: 'result', phase: 'error' },
    { stage: 'error', phase: 'rejected' },
    { stage: 'start', phase: 'aborted' },
    { stage: 'result', phase: 'executing' },
    { stage: 'error' },
    { stage: 'start' },
    { status: 'weird', stage: 'result' },
  ] as const

  test.each(cases)('与 shared 结果一致：%j', (input) => {
    expect(resolveToolLogStatus(input as never)).toBe(resolveEventStatus(input as never))
  })
})
