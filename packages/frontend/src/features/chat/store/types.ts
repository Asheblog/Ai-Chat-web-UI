import type {
  ChatSession,
  ChatState,
  Message,
  MessageBody,
  MessageMeta,
  MessageRenderCacheEntry,
  MessageStreamMetrics,
  ToolEvent,
} from '@/types'
import type { ModelItem } from '@/store/models-store'
import type { StateCreator, StoreApi } from 'zustand'

export type MessageId = number | string

export type StreamSendOptions = {
  reasoningEnabled?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high'
  ollamaThink?: boolean
  saveReasoning?: boolean
  features?: {
    web_search?: boolean
    web_search_scope?: string
    web_search_include_summary?: boolean
    web_search_include_raw?: boolean
    web_search_size?: number
  }
  replyToMessageId?: number | string
  replyToClientMessageId?: string
  traceEnabled?: boolean
  contextEnabled?: boolean
  clientMessageId?: string
  customBody?: Record<string, any>
  customHeaders?: Array<{ name: string; value: string }>
  streamKey?: string
  knowledgeBaseIds?: number[]
}

export interface ShareSelectionState {
  enabled: boolean
  sessionId: number | null
  selectedMessageIds: number[]
}

export interface StreamUsageSnapshot {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  context_limit?: number | null
  context_remaining?: number | null
}

export interface StreamCompletionSnapshot {
  sessionId: number
  messageId: number | null
  clientMessageId: string | null
  content: string
  reasoning: string
  reasoningPlayedLength?: number | null
  usage?: StreamUsageSnapshot | null
  toolEvents?: ToolEvent[]
  reasoningStatus?: MessageMeta['reasoningStatus']
  streamStatus?: MessageMeta['streamStatus']
  completedAt: number
  metrics?: MessageStreamMetrics | null
}

export interface StreamAccumulator {
  sessionId: number
  assistantId: MessageId
  content: string
  reasoning: string
  reasoningPlayedLength: number
  pendingContent: string
  pendingReasoning: string
  pendingMeta: Partial<Pick<MessageMeta, 'reasoningStatus' | 'reasoningIdleMs' | 'reasoningDurationSeconds'>>
  flushTimer: ReturnType<typeof setTimeout> | null
  reasoningDesired: boolean
  reasoningActivated: boolean
  clientMessageId: string | null
  webSearchRequested: boolean
  assistantClientMessageId?: string | null
  lastUsage?: StreamUsageSnapshot | null
  startedAt: number
  firstChunkAt?: number | null
  completedAt?: number | null
  /** 后端发送的 metrics，优先使用 */
  serverMetrics?: MessageStreamMetrics | null
}

export type ActiveStreamEntry = StreamAccumulator & {
  streamKey: string
  stopRequested: boolean
}

export interface SessionSlice {
  fetchSessions: () => Promise<void>
  createSession: (
    modelId: string,
    title?: string,
    connectionId?: number,
    rawId?: string,
    systemPrompt?: string | null,
  ) => Promise<ChatSession | null>
  selectSession: (sessionId: number) => void
  deleteSession: (sessionId: number) => Promise<void>
  updateSessionTitle: (sessionId: number, title: string) => Promise<void>
  switchSessionModel: (sessionId: number, model: ModelItem) => Promise<void>
  updateSessionPrefs: (
    sessionId: number,
    prefs: Partial<{
      reasoningEnabled: boolean
      reasoningEffort: 'low' | 'medium' | 'high'
      ollamaThink: boolean
      systemPrompt: string | null
    }>,
  ) => Promise<boolean>
  toggleSessionPin: (sessionId: number, pinned: boolean) => Promise<boolean>
}

export interface UsageSlice {
  fetchSessionsUsage: () => Promise<void>
  fetchUsage: (sessionId: number) => Promise<void>
}

export interface MessageSlice {
  fetchMessages: (
    sessionId: number,
    options?: {
      page?: number | 'latest'
      mode?: 'replace' | 'prepend'
      limit?: number
    },
  ) => Promise<void>
  loadOlderMessages: (sessionId: number) => Promise<void>
  addMessage: (message: Message) => void
  applyRenderedContent: (
    messageId: MessageId,
    payload: {
      contentHtml?: string | null
      reasoningHtml?: string | null
      contentVersion?: number
      reasoningVersion?: number
    },
  ) => void
  invalidateRenderedContent: (messageId?: MessageId) => void
  editLastUserMessage: (sessionId: number, messageId: MessageId, content: string) => Promise<boolean>
  regenerateAssistantMessage: (messageId: MessageId) => Promise<void>
  cycleAssistantVariant: (parentKey: string, direction: 'prev' | 'next') => void
}

export interface StreamSlice {
  sendMessage: (sessionId: number, content: string) => Promise<void>
  streamMessage: (
    sessionId: number,
    content: string,
    images?: Array<{ data: string; mime: string }>,
    options?: StreamSendOptions,
  ) => Promise<void>
  stopStreaming: () => void
}

export interface ShareSlice {
  enterShareSelectionMode: (sessionId: number, messageId?: number) => void
  toggleShareSelection: (sessionId: number, messageId: number) => void
  setShareSelection: (sessionId: number, messageIds: number[]) => void
  clearShareSelection: () => void
  exitShareSelectionMode: () => void
}

export interface CommonSlice {
  clearError: () => void
}

export type ChatStore = ChatState &
  SessionSlice &
  UsageSlice &
  MessageSlice &
  StreamSlice &
  ShareSlice &
  CommonSlice

export type ChatStoreSetState = Parameters<StateCreator<ChatStore>>[0]
export type ChatStoreGetState = Parameters<StateCreator<ChatStore>>[1]
export type ChatStoreApi = StoreApi<ChatStore>

export interface ChatStoreRuntime {
  activeStreams: Map<string, ActiveStreamEntry>
  streamingPollers: Map<number, ReturnType<typeof setInterval>>
  registerActiveStream: (entry: ActiveStreamEntry) => void
  unregisterActiveStream: (streamKey: string) => void
  findStreamByAssistantId: (messageId: MessageId | null | undefined) => ActiveStreamEntry | null
  findStreamByClientMessageId: (clientMessageId?: string | null) => ActiveStreamEntry | null
  stopMessagePoller: (messageId: number) => void
  stopAllMessagePollers: () => void
  persistSnapshotForStream: (stream: ActiveStreamEntry | null) => void
  persistCompletionRecord: (snapshot: StreamCompletionSnapshot) => void
  recomputeStreamingState: () => void
  streamingFlagUpdate: (state: ChatState, sessionId: number | null, streaming: boolean) => Partial<ChatState>
  applyBufferedSnapshots: (sessionId: number) => void
  applyServerMessageSnapshot: (message: Message) => void
  updateMetaStreamStatus: (
    messageId: MessageId,
    status: MessageMeta['streamStatus'],
    streamError?: string | null,
  ) => void
  startMessageProgressWatcher: (sessionId: number, messageId: number) => void
  flushStreamBuffer: (stream: ActiveStreamEntry | null, force?: boolean) => void
  scheduleFlush: (stream: ActiveStreamEntry | null) => void
  clearActiveStream: (stream: ActiveStreamEntry | null) => void
  removeCompletionSnapshot: (
    sessionId: number,
    opts: { messageId?: number | null; clientMessageId?: string | null },
  ) => void
  getSessionCompletionSnapshots: (sessionId: number) => StreamCompletionSnapshot[]
  snapshotDebug: (...args: any[]) => void
}

export type ChatSliceCreator<T> = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
  runtime: ChatStoreRuntime,
) => T
