export interface TaskTraceSummary {
  id: number;
  sessionId: number | null;
  messageId: number | null;
  clientMessageId: string | null;
  actor: string;
  status: string;
  traceLevel: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  metadata?: Record<string, unknown> | null;
  eventCount: number;
  latexTrace?: LatexTraceSummary | null;
}

export interface TaskTraceEventRecord {
  id: number;
  seq: number;
  eventType: string;
  payload: any;
  timestamp: string;
}

export interface LatexTraceSummary {
  id: number;
  taskTraceId?: number;
  matchedBlocks: number;
  unmatchedBlocks: number;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LatexTraceEventRecord {
  seq: number;
  matched: boolean;
  reason: string;
  raw: string;
  normalized: string;
  trimmed: string;
}
