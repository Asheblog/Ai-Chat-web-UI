export class Tokenizer {
  /**
   * 计算文本的token数量
   */
  static async countTokens(text: string): Promise<number> {
    // 轻量估算：1 token ≈ 4 个字符（英文近似），中文按 1 字≈1 token 近似
    if (!text) return 0;
    // 简单启发：统计 ASCII 与非 ASCII 的比例做加权
    let ascii = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) < 128) ascii++;
    }
    const nonAscii = text.length - ascii;
    const asciiTokens = Math.ceil(ascii / 4);
    const nonAsciiTokens = nonAscii; // 非 ASCII 近似 1:1
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
