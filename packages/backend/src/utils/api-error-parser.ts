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
  | 'upstream_quota'        // 上游服务配额耗尽
  | 'model_cooldown'        // 模型凭证冷却
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
  resetInfo?: {
    resetsAt?: number;      // Unix timestamp
    resetsInSeconds?: number;
  };
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
 * 上游配额限制错误模式（第三方API代理服务）
 */
const UPSTREAM_QUOTA_PATTERNS = [
  /usage_limit_reached/i,
  /usage limit has been reached/i,
];

/**
 * 模型冷却错误模式
 */
const MODEL_COOLDOWN_PATTERNS = [
  /model_cooldown/i,
  /credentials? .* cooling down/i,
  /all credentials .* cooling/i,
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
 * 解析上游配额限制错误的重置时间
 */
function parseUpstreamQuotaResetInfo(text: string): { resetsAt?: number; resetsInSeconds?: number } | null {
  try {
    // 尝试解析 JSON 格式的错误
    const jsonMatch = text.match(/\{[^{}]*"(?:resets_at|reset_seconds|resets_in_seconds)"[^{}]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const result: { resetsAt?: number; resetsInSeconds?: number } = {};
      
      if (parsed.resets_at && typeof parsed.resets_at === 'number') {
        result.resetsAt = parsed.resets_at;
      }
      if (parsed.resets_in_seconds && typeof parsed.resets_in_seconds === 'number') {
        result.resetsInSeconds = parsed.resets_in_seconds;
      }
      if (parsed.reset_seconds && typeof parsed.reset_seconds === 'number') {
        result.resetsInSeconds = parsed.reset_seconds;
      }
      
      if (Object.keys(result).length > 0) {
        return result;
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

/**
 * 格式化剩余时间为人类可读格式
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes}分钟`;
  }
  const hours = Math.floor(seconds / 3600);
  const remainingMinutes = Math.ceil((seconds % 3600) / 60);
  if (remainingMinutes > 0) {
    return `${hours}小时${remainingMinutes}分钟`;
  }
  return `${hours}小时`;
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

  // 检查模型冷却错误（优先检查，因为这是更具体的错误类型）
  if (matchesAnyPattern(combinedText, MODEL_COOLDOWN_PATTERNS)) {
    const resetInfo = parseUpstreamQuotaResetInfo(combinedText);
    let suggestion = '当前模型的所有 API 凭证正在冷却中，请稍候重试或切换其他模型。';
    if (resetInfo?.resetsInSeconds) {
      suggestion = `当前模型的所有 API 凭证正在冷却中，预计 ${formatDuration(resetInfo.resetsInSeconds)} 后恢复。建议切换其他模型或稍候重试。`;
    }
    
    // 提取模型名称
    const modelMatch = combinedText.match(/"model"\s*:\s*"([^"]+)"/);
    const modelName = modelMatch ? modelMatch[1] : null;
    const message = modelName
      ? `模型 ${modelName} 暂时不可用`
      : '当前模型暂时不可用';
    
    return {
      type: 'model_cooldown',
      message,
      originalMessage: texts[0],
      suggestion,
      resetInfo: resetInfo || undefined,
    };
  }

  // 检查上游配额限制错误
  if (matchesAnyPattern(combinedText, UPSTREAM_QUOTA_PATTERNS)) {
    const resetInfo = parseUpstreamQuotaResetInfo(combinedText);
    let suggestion = '上游 API 服务的配额已用尽，请联系管理员或更换其他 API 连接。';
    if (resetInfo?.resetsInSeconds) {
      suggestion = `上游 API 服务的配额已用尽，预计 ${formatDuration(resetInfo.resetsInSeconds)} 后重置。`;
    } else if (resetInfo?.resetsAt) {
      const resetDate = new Date(resetInfo.resetsAt * 1000);
      suggestion = `上游 API 服务的配额已用尽，将于 ${resetDate.toLocaleString('zh-CN')} 重置。`;
    }
    
    // 提取计划类型
    const planMatch = combinedText.match(/"plan_type"\s*:\s*"([^"]+)"/);
    const planType = planMatch ? planMatch[1] : null;
    const message = planType
      ? `上游服务配额已用尽（${planType} 计划）`
      : '上游服务配额已用尽';
    
    return {
      type: 'upstream_quota',
      message,
      originalMessage: texts[0],
      suggestion,
      resetInfo: resetInfo || undefined,
    };
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
