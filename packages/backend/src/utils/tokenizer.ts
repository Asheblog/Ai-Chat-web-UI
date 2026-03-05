import { TokenizerService } from '../services/tokenizer/tokenizer-service'

export { TokenizerService } from '../services/tokenizer/tokenizer-service'

interface TokenizerUtilsDeps {
  tokenizerService: TokenizerService
}

let configuredTokenizerService: TokenizerService | null = null
let fallbackTokenizerService: TokenizerService | null = null

const resolveTokenizerService = (): TokenizerService => {
  if (configuredTokenizerService) return configuredTokenizerService
  if (!fallbackTokenizerService) {
    fallbackTokenizerService = new TokenizerService()
  }
  return fallbackTokenizerService
}

export const configureTokenizerUtils = (deps: TokenizerUtilsDeps): void => {
  configuredTokenizerService = deps.tokenizerService
}

/**
 * 保持静态 API 兼容，内部委派到默认 TokenizerService。
 */
export class Tokenizer {
  static async countTokens(text: string): Promise<number> {
    return resolveTokenizerService().countTokens(text)
  }

  static async countMessageTokens(role: string, content: string): Promise<number> {
    return resolveTokenizerService().countMessageTokens(role, content)
  }

  static async countConversationTokens(messages: Array<{ role: string; content: string }>): Promise<number> {
    return resolveTokenizerService().countConversationTokens(messages)
  }

  static async truncateMessages(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
  ): Promise<Array<{ role: string; content: string }>> {
    return resolveTokenizerService().truncateMessages(messages, maxTokens)
  }
}
