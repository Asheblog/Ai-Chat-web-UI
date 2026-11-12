/**
 * Anthropic Messages API 适配层入口。
 *
 * 具体实现拆分：
 * - anthropic-convert：请求/非流式响应转换
 * - anthropic-sse：SSE 事件 -> OpenAI chunk
 * - anthropic-http：Response 包装与 JSON 读取
 */
export {
  convertAnthropicMessageToChatCompletion,
  convertChatCompletionsRequestToAnthropic,
} from './anthropic-convert'
export {
  convertAnthropicSseChunk,
  createAnthropicSseState,
  createAnthropicSseToOpenAIStream,
  finishAnthropicSse,
} from './anthropic-sse'
export type { AnthropicSseState } from './anthropic-sse'
export { adaptProviderResponse, readProviderJson } from './anthropic-http'
