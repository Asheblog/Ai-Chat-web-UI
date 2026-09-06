import type {
  ResearchPlanApprovalState,
  ResearchPlanPayload,
} from '@aichat/shared/chat-stream-contract'
import type {
  RichMessageEvidenceConfidence,
} from '@aichat/shared/rich-payload'
import type {
  ToolCallPhase,
  ToolCallSource,
  ToolInterventionState,
  WebSearchHit,
} from '@aichat/shared/api-contract'

export interface ToolEventDetails {
  // 通用工具调用字段（ToolCall V2）
  argumentsText?: string;
  argumentsPatch?: string;
  resultText?: string;
  resultJson?: unknown;
  url?: string;
  title?: string;
  excerpt?: string;
  wordCount?: number;
  siteName?: string;
  byline?: string;
  leadImageUrl?: string;
  images?: Array<{
    url: string;
    alt?: string;
    source?: string;
    width?: number;
    height?: number;
    confidence?: RichMessageEvidenceConfidence;
    description?: string;
    title?: string;
  }>;
  assessedImages?: Array<{
    url: string;
    title?: string;
    alt?: string;
    sourceUrl?: string;
    confidence?: RichMessageEvidenceConfidence;
    description?: string;
    relevance?: string;
  }>;
  requestedLimit?: number | null;
  appliedLimit?: number | null;
  warning?: string;
  groupId?: string;
  taskType?: 'search' | 'read_url' | string;
  engine?: string;
  queryLanguage?: 'zh' | 'en' | 'unknown' | string;
  originalQuery?: string;
  expandedQuery?: string;
  queryIndex?: number;
  engineCount?: number;
  queryCount?: number;
  hitsCount?: number;
  searchTaskTotal?: number;
  searchTaskSucceeded?: number;
  searchTaskFailed?: number;
  autoReadEnabled?: boolean;
  autoReadRequested?: number;
  autoReadSucceeded?: number;
  autoReadFailed?: number;
  errorCode?: string;
  httpStatus?: number;
  fallbackUsed?: string;
  autoTriggered?: boolean;
  parentTool?: string;
  parentCallId?: string;
  rank?: number;
  code?: string;
  input?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  reasoningOffset?: number;
  reasoningOffsetStart?: number;
  reasoningOffsetEnd?: number;
  plan?: ResearchPlanPayload;
  approval?: ResearchPlanApprovalState;
  [key: string]: unknown;
}

export interface ToolEvent {
  // 兼容字段（旧链路）
  id: string;
  sessionId: number;
  messageId: number | string;
  tool: string;
  stage: 'start' | 'result' | 'error';
  status: 'running' | 'success' | 'error' | 'pending' | 'rejected' | 'aborted';
  query?: string;
  hits?: WebSearchHit[];
  error?: string;
  summary?: string;
  createdAt: number;
  details?: ToolEventDetails;
  // ToolCall V2
  callId?: string;
  identifier?: string;
  apiName?: string;
  source?: ToolCallSource;
  phase?: ToolCallPhase;
  argumentsText?: string;
  argumentsPatch?: string;
  resultText?: string;
  resultJson?: unknown;
  intervention?: ToolInterventionState;
  thoughtSignature?: string | null;
  updatedAt?: number;
}
