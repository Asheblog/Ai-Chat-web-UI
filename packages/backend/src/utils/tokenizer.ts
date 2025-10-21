export class Tokenizer {
  // 精确分词开关（环境变量 TOKENIZER_MODE=precise|heuristic）
  private static get preciseEnabled(): boolean {
    const mode = (process.env.TOKENIZER_MODE ?? 'precise').toLowerCase();
    return mode !== 'heuristic';
  }

  // 缓存 gpt-tokenizer 的 encode
  private static _encode: ((text: string) => number[]) | null = null;
  private static async getEncoder(): Promise<((text: string) => number[]) | null> {
    if (!this.preciseEnabled) return null;
    if (this._encode) return this._encode;
    try {
      const mod: any = await import('gpt-tokenizer');
      if (typeof mod.encode === 'function') {
        this._encode = mod.encode as (t: string) => number[];
        return this._encode;
      }
      return null;
    } catch {
      return null;
    }
  }
  /**
   * 计算文本的token数量
   */
  static async countTokens(text: string): Promise<number> {
    if (!text) return 0;
    // 优先使用精确分词
    try {
      const enc = await this.getEncoder();
      if (enc) {
        return enc(text).length;
      }
    } catch {}
    // 启发式估算兜底：1 token ≈ 4 英文字符，中文≈1字1 token
    let ascii = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) < 128) ascii++;
    }
    const nonAscii = text.length - ascii;
    const asciiTokens = Math.ceil(ascii / 4);
    const nonAsciiTokens = nonAscii;
    return asciiTokens + nonAsciiTokens;
  }

  /**
   * 估算对话消息的token数量
   * 考虑了OpenAI Chat API的消息格式开销
   */
  static async countMessageTokens(role: string, content: string): Promise<number> {
    // 每条消息的基础开销（role, content等字段）
    const baseTokens = 4;

    // 计算内容的token数量
    const contentTokens = await this.countTokens(content);

    // 角色名称的token数量
    const roleTokens = await this.countTokens(role);

    return baseTokens + contentTokens + roleTokens;
  }

  /**
   * 计算对话上下文的总token数量
   */
  static async countConversationTokens(messages: Array<{role: string, content: string}>): Promise<number> {
    let totalTokens = 3; // 对话的基础开销

    for (const message of messages) {
      totalTokens += await this.countMessageTokens(message.role, message.content);
    }

    return totalTokens;
  }

  /**
   * 基于token限制截断对话历史
   * 保留最新的消息，直到达到token限制
   */
  static async truncateMessages(
    messages: Array<{role: string, content: string}>,
    maxTokens: number
  ): Promise<Array<{role: string, content: string}>> {
    if (messages.length === 0) return messages;

    // 从最新消息开始倒序计算token
    let reversedMessages = [...messages].reverse();
    let accumulatedTokens = 3; // 基础开销
    let includedMessages: typeof messages = [];

    for (const message of reversedMessages) {
      const messageTokens = await this.countMessageTokens(message.role, message.content);

      if (accumulatedTokens + messageTokens <= maxTokens) {
        accumulatedTokens += messageTokens;
        includedMessages.unshift(message);
      } else {
        break;
      }
    }

    return includedMessages;
  }
}
