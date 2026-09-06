import type { IToolHandler, ToolCall, ToolCallContext, ToolDefinition, ToolHandlerResult } from './types'
import { loadPersistedChatImages } from '../../../services/attachment/legacy-utils'
import { VisionProxyService, type VisionProxyConfig } from '../services/vision-proxy-service'

/**
 * 视觉分析工具——主模型无 vision 时由主模型自主调用，
 * 读取当前消息附件图片并交给指定 vision 模型转写，描述作为工具结果回传。
 */
export class VisionProxyToolHandler implements IToolHandler {
  readonly toolName = 'analyze_visual_media'
  private service: VisionProxyService

  constructor(private config: VisionProxyConfig, service?: VisionProxyService) {
    this.service = service ?? new VisionProxyService()
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.toolName,
        description:
          '分析当前用户消息中的图片内容，返回图片的文字描述。当用户发送了图片、或回答需要理解图片内容时调用此工具。图片取自当前消息附件，无需在参数中传递图片。工具返回后请直接依据描述回答用户。',
        parameters: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: '针对图片的具体问题（可选）；留空则返回完整描述',
            },
          },
          required: [],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const toolCallId = toolCall.id ?? ''
    const question = typeof args?.question === 'string' ? args.question : ''
    const fail = (error: string): ToolHandlerResult => ({
      toolCallId,
      toolName: this.toolName,
      message: { role: 'tool', tool_call_id: toolCallId, name: this.toolName, content: error },
    })

    if (!context.messageId) {
      return fail('无法定位当前消息，请重试')
    }
    let images: Array<{ data: string; mime: string }>
    try {
      images = await loadPersistedChatImages(context.messageId)
    } catch {
      return fail('读取图片失败，请重试')
    }
    if (!Array.isArray(images) || images.length === 0) {
      return fail('当前消息没有可分析的图片')
    }
    try {
      const { description, modelRawId } = await this.service.transcribeImages(images, question, this.config)
      return {
        toolCallId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCallId,
          name: this.toolName,
          content: `图片描述（由 ${modelRawId} 转写）：\n${description}`,
        },
      }
    } catch (error) {
      return fail(`图片转写失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
