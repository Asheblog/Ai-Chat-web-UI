/**
 * API 错误解析器
 * 将 API 供应商返回的错误转换为用户友好的错误消息
 */

/**
 * 错误类型枚举
 */
export type ApiErrorType =
  | 'content_moderation'    // 内容审查/安全过滤
  | 'context_length'        // 上下文长度超限
  | 'rate_limit'            // 请求频率限制
  | 'quota_exceeded'        // 配额耗尽
  | 'authentication'        // 认证失败
  | 'invalid_request'       // 无效请求
  | 'server_error'          // 服务器错误
  | 'network'               // 网络错误
  | 'unknown';              // 未知错误

/**
 * 解析后的错误信息
 */
export interface ParsedApiError {
  type: ApiErrorType;
  message: string;
  originalMessage?: string;
  suggestion?: string;
}

/**
 * 内容审查相关的错误模式
 */
const CONTENT_MODERATION_PATTERNS = [
  /content\s*exists?\s*risk/i,
  /content\s*filter/i,
  /content\s*moderation/i,
  /content\s*policy/i,
  /safety\s*filter/i,
  /sensitive\s*content/i,
  /inappropriate\s*content/i,
  /违规|敏感|审核|风控|安全/,
];

/**
 * 上下文长度错误模式
 */
const CONTEXT_LENGTH_PATTERNS = [
  /maximum context length is (\d+)\s*tokens[\s\S]*?requested\s+(\d+)\s*tokens/i,
  /context[_\s-]?length[\s\S]*exceed/i,
  /token\s*limit\s*exceeded/i,
  /max_tokens/i,
];

/**
 * 频率限制错误模式
 */
const RATE_LIMIT_PATTERNS = [
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /请求过于频繁/,
];

/**
 * 配额错误模式
 */
const QUOTA_PATTERNS = [
  /quota\s*exceeded/i,
  /insufficient\s*quota/i,
  /billing/i,
  /余额不足|配额/,
];

/**
 * 认证错误模式
 */
const AUTH_PATTERNS = [
  /invalid\s*api\s*key/i,
  /authentication/i,
  /unauthorized/i,
  /api\s*key\s*invalid/i,
];

/**
 * 从错误对象中提取文本候选项
 */
function extractErrorTexts(error: unknown): string[] {
  const texts: string[] = [];

  const addCandidate = (value: unknown): void => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(addCandidate);
      return;
    }
    if (typeof value === 'string') {
      texts.push(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      texts.push(String(value));
    } else if (typeof value === 'object') {
      try {
        texts.push(JSON.stringify(value));
      } catch {
        // ignore
      }
    }
  };

  addCandidate(error);
  if (error && typeof error === 'object') {
    const errObj = error as Record<string, unknown>;
    addCandidate(errObj.message);
    addCandidate(errObj.error);
    if ('payload' in errObj) {
      addCandidate(errObj.payload);
    }
    if ('response' in errObj && errObj.response && typeof errObj.response === 'object') {
      addCandidate((errObj.response as Record<string, unknown>).data);
    }
  }

  return texts.filter(Boolean);
}

/**
 * 检查文本是否匹配任一模式
 */
function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * 解析上下文长度错误的详细信息
 */
function parseContextLengthDetails(text: string): string | null {
  const match = text.match(
    /maximum context length is (\d+)\s*tokens[\s\S]*?requested\s+(\d+)\s*tokens(?:[\s\S]*?\((\d+)\s+in the messages,\s+(\d+)\s+in the completion\))?/i
  );

  if (match) {
    const [, limit, requested, messageTokens, completionTokens] = match;
    const parts: string[] = [];
    if (limit && requested) {
      parts.push(`最大 ${limit} tokens，当前 ${requested}`);
    }
    if (messageTokens && completionTokens) {
      parts.push(`消息 ${messageTokens}，补全 ${completionTokens}`);
    }
    return parts.length > 0 ? `（${parts.join('；')}）` : '';
  }
  return null;
}

/**
 * 解析 API 错误
 */
export function parseApiError(error: unknown): ParsedApiError {
  const texts = extractErrorTexts(error);
  const combinedText = texts.join(' ');

  // 检查内容审查错误
  if (matchesAnyPattern(combinedText, CONTENT_MODERATION_PATTERNS)) {
    return {
      type: 'content_moderation',
      message: '返回内容因安全审查被截断',
      originalMessage: texts[0],
      suggestion: '当前 API 供应商对内容进行了安全过滤，建议更换其他 API 供应商或调整对话内容后重试。',
    };
  }

  // 检查上下文长度错误
  for (const text of texts) {
    if (matchesAnyPattern(text, CONTEXT_LENGTH_PATTERNS)) {
      const detail = parseContextLengthDetails(text) || '';
      return {
        type: 'context_length',
        message: `超过模型上下文长度限制${detail}`,
        originalMessage: texts[0],
        suggestion: '请缩短输入、减少历史消息或降低期望回复长度后重试。',
      };
    }
  }

  // 检查频率限制错误
  if (matchesAnyPattern(combinedText, RATE_LIMIT_PATTERNS)) {
    return {
      type: 'rate_limit',
      message: '请求过于频繁',
      originalMessage: texts[0],
      suggestion: '请稍等片刻后重试。',
    };
  }

  // 检查配额错误
  if (matchesAnyPattern(combinedText, QUOTA_PATTERNS)) {
    return {
      type: 'quota_exceeded',
      message: 'API 配额已用尽',
      originalMessage: texts[0],
      suggestion: '请检查 API 供应商账户余额或更换其他 API 密钥。',
    };
  }

  // 检查认证错误
  if (matchesAnyPattern(combinedText, AUTH_PATTERNS)) {
    return {
      type: 'authentication',
      message: 'API 认证失败',
      originalMessage: texts[0],
      suggestion: '请检查 API 密钥是否正确配置。',
    };
  }

  // 检查 HTTP 状态码
  const statusCode = (error as Record<string, unknown>)?.status as number | undefined;
  if (statusCode) {
    if (statusCode === 401 || statusCode === 403) {
      return {
        type: 'authentication',
        message: 'API 认证失败',
        originalMessage: texts[0],
        suggestion: '请检查 API 密钥是否正确配置。',
      };
    }
    if (statusCode === 429) {
      return {
        type: 'rate_limit',
        message: '请求过于频繁',
        originalMessage: texts[0],
        suggestion: '请稍等片刻后重试。',
      };
    }
    if (statusCode >= 500) {
      return {
        type: 'server_error',
        message: 'API 服务暂时不可用',
        originalMessage: texts[0],
        suggestion: '请稍后重试或更换其他 API 供应商。',
      };
    }
  }

  // 未知错误
  return {
    type: 'unknown',
    message: texts[0] || 'AI 服务请求失败',
    originalMessage: texts[0],
  };
}

/**
 * 获取用户友好的错误消息
 */
export function getFriendlyErrorMessage(error: unknown): string {
  const parsed = parseApiError(error);

  if (parsed.suggestion) {
    return `${parsed.message}。${parsed.suggestion}`;
  }

  return parsed.message;
}

/**
 * 检查是否为内容审查错误
 */
export function isContentModerationError(error: unknown): boolean {
  const parsed = parseApiError(error);
  return parsed.type === 'content_moderation';
}

/**
 * 旧版兼容：解析上下文长度错误消息
 * @deprecated 使用 parseApiError 代替
 */
export function resolveContextLimitErrorMessage(error: unknown): string | null {
  const parsed = parseApiError(error);
  if (parsed.type === 'context_length') {
    return `${parsed.message}，${parsed.suggestion || '请缩短输入后重试。'}`;
  }
  return null;
}
