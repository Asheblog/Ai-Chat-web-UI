import type { Message } from '@/types'
import type {
  ActiveStreamEntry,
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
} from '../types'

export interface StreamEventContext {
  active: ActiveStreamEntry
  assistantPlaceholder: Message
  userMessageId: number
  sessionId: number
  set: ChatStoreSetState
  get: ChatStoreGetState
  runtime: ChatStoreRuntime
}
