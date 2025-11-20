export interface TokenEncoder {
  encode(text: string): number[]
}

export interface TokenizerDeps {
  encoderFactory?: () => Promise<TokenEncoder | null>
  now?: () => Date
}

const countFallbackTokens = (text: string): number => {
  if (!text) return 0
  let ascii = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++
  }
  const nonAscii = text.length - ascii
  const asciiTokens = Math.ceil(ascii / 4)
  return asciiTokens + nonAscii
}

export class TokenizerService {
  private encoderFactory: () => Promise<TokenEncoder | null>

  constructor(deps: TokenizerDeps = {}) {
    this.encoderFactory =
      deps.encoderFactory ??
      (async () => {
        try {
          const mod: any = await import('gpt-tokenizer')
          if (typeof mod.encode === 'function') {
            return { encode: mod.encode as (text: string) => number[] }
          }
        } catch {}
        return null
      })
  }

  async countTokens(text: string): Promise<number> {
    if (!text) return 0
    try {
      const encoder = await this.encoderFactory()
      if (encoder) {
        return encoder.encode(text).length
      }
    } catch {}
    return countFallbackTokens(text)
  }

  async countMessageTokens(role: string, content: string): Promise<number> {
    const baseTokens = 4
    const contentTokens = await this.countTokens(content)
    const roleTokens = await this.countTokens(role)
    return baseTokens + contentTokens + roleTokens
  }

  async countConversationTokens(messages: Array<{ role: string; content: string }>): Promise<number> {
    let totalTokens = 3
    for (const message of messages) {
      totalTokens += await this.countMessageTokens(message.role, message.content)
    }
    return totalTokens
  }

  async truncateMessages(
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
  ): Promise<Array<{ role: string; content: string }>> {
    if (messages.length === 0) return messages
    let reversedMessages = [...messages].reverse()
    let accumulatedTokens = 3
    const included: typeof messages = []
    for (const message of reversedMessages) {
      const messageTokens = await this.countMessageTokens(message.role, message.content)
      if (accumulatedTokens + messageTokens <= maxTokens) {
        accumulatedTokens += messageTokens
        included.unshift(message)
      } else {
        break
      }
    }
    return included
  }
}

export const tokenizerService = new TokenizerService()
