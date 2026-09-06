import { VisionProxyToolHandler } from '../vision-proxy-handler'
import { VisionProxyServiceError } from '../../services/vision-proxy-service'

jest.mock('../../../../services/attachment/legacy-utils', () => ({
  loadPersistedChatImages: jest.fn(),
}))

import { loadPersistedChatImages } from '../../../../services/attachment/legacy-utils'

const config = {
  enabled: true,
  connectionId: 1,
  modelId: 'qwen-vl-max',
  reasoningEnabled: false,
  reasoningEffort: '',
}
const context = {
  sessionId: 1,
  messageId: 100,
  emitReasoning: jest.fn(),
  sendToolEvent: jest.fn(),
} as any

const makeService = (impl: Partial<VisionProxyService>): any => ({
  transcribeImages: jest.fn(),
  ...impl,
})

describe('VisionProxyToolHandler', () => {
  it('exposes toolName and definition', () => {
    const handler = new VisionProxyToolHandler(config)
    expect(handler.toolName).toBe('analyze_visual_media')
    expect(handler.canHandle('analyze_visual_media')).toBe(true)
    expect(handler.toolDefinition.function.name).toBe('analyze_visual_media')
  })

  it('returns error result when messageId missing', async () => {
    const handler = new VisionProxyToolHandler(config, makeService({}))
    const result = await handler.handle({ id: 'tc1' }, {}, { ...context, messageId: null })
    expect(result.message.content).toContain('无法定位当前消息')
  })

  it('returns error result when no persisted images', async () => {
    ;(loadPersistedChatImages as jest.Mock).mockResolvedValue([])
    const handler = new VisionProxyToolHandler(config, makeService({}))
    const result = await handler.handle({ id: 'tc1' }, {}, context)
    expect(result.message.content).toContain('没有可分析的图片')
  })

  it('returns description from service as tool result', async () => {
    ;(loadPersistedChatImages as jest.Mock).mockResolvedValue([{ data: 'aGk=', mime: 'image/png' }])
    const service = makeService({ transcribeImages: jest.fn().mockResolvedValue({ description: '图片里有一只猫', modelRawId: 'qwen-vl-max' }) })
    const handler = new VisionProxyToolHandler(config, service)
    const result = await handler.handle({ id: 'tc1' }, { question: '这是什么' }, context)
    expect(service.transcribeImages).toHaveBeenCalledWith([{ data: 'aGk=', mime: 'image/png' }], '这是什么', config)
    expect(result.message.role).toBe('tool')
    expect(result.message.content).toContain('图片里有一只猫')
    expect(result.message.content).toContain('qwen-vl-max')
  })

  it('returns error text when service throws', async () => {
    ;(loadPersistedChatImages as jest.Mock).mockResolvedValue([{ data: 'aGk=', mime: 'image/png' }])
    const service = makeService({ transcribeImages: jest.fn().mockRejectedValue(new VisionProxyServiceError('配额不足', 502)) })
    const handler = new VisionProxyToolHandler(config, service)
    const result = await handler.handle({ id: 'tc1' }, {}, context)
    expect(result.message.content).toContain('图片转写失败')
    expect(result.message.content).toContain('配额不足')
  })
})
