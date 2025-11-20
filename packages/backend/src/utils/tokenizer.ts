import { TokenizerService, tokenizerService } from '../services/tokenizer/tokenizer-service'

export { TokenizerService } from '../services/tokenizer/tokenizer-service'

/**
 * 保持静态 API 兼容，内部委派到默认 TokenizerService。
 */
export class Tokenizer {
  static async countTokens(text: string): Promise<number> {
    return tokenizerService.countTokens(text)
  }

  static async countMessageTokens(role: string, content: string): Promise<number> {
    return tokenizerService.countMessageTokens(role, content)
  }

  static async countConversationTokens(messages: Array<{ role: string; content: string }>): Promise<number> {
    return tokenizerService.countConversationTokens(messages)
  }

  static async truncateMessages(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
  ): Promise<Array<{ role: string; content: string }>> {
    return tokenizerService.truncateMessages(messages, maxTokens)
  }
}
