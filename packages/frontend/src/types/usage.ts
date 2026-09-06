export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface SessionUsageTotalsItem {
  sessionId: number;
  totals: UsageTotals;
}

export interface MessageStreamMetrics {
  firstTokenLatencyMs?: number | null;
  responseTimeMs?: number | null;
  tokensPerSecond?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}
