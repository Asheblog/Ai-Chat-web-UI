/**
 * stream parser 对 execution `reasoning_done` artifact 事件的归一化测试。
 * 后端在推理结束时发出 step_artifact(kind=result, name=reasoning_done, data={duration})，
 * 前端 stream-slice 依赖 parser 将其映射为 { type: 'reasoning', done: true, duration } 以展示耗时。
 */
import { normalizeStreamChunk } from '@aichat/shared/chat-stream-parser'

describe('normalizeStreamChunk reasoning_done', () => {
  it('将 reasoning_done artifact 归一化为 reasoning done 事件', () => {
    const chunk = normalizeStreamChunk({
      type: 'step_artifact',
      stepId: 'assistant:x',
      payload: {
        kind: 'result',
        name: 'reasoning_done',
        data: { duration: 4 },
      },
    })

    expect(chunk).toEqual({
      type: 'reasoning',
      done: true,
      duration: 4,
    })
  })

  it('reasoning_done 无 duration 时归一化为 done 事件（duration 缺省）', () => {
    const chunk = normalizeStreamChunk({
      type: 'step_artifact',
      stepId: 'assistant:x',
      payload: {
        kind: 'result',
        name: 'reasoning_done',
        data: {},
      },
    })

    expect(chunk?.type).toBe('reasoning')
    expect(chunk?.done).toBe(true)
    expect(chunk?.duration).toBeUndefined()
  })
})
