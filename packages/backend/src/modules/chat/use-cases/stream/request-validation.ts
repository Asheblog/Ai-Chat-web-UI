import type { Actor } from '../../../../types'
import type { ChatService } from '../../../../services/chat'

export interface NormalizedChatStreamPayload {
  sessionId: number
  replyToMessageId: number | null
  replyToClientMessageId: string | null
  clientMessageId: string | null
  content: string
  images: unknown
  traceToggle: boolean | undefined
}

export class ChatStreamRequestValidation {
  constructor(private readonly deps: { chatService: ChatService }) {}

  async ensureSession(actor: Actor, sessionId: number) {
    return this.deps.chatService.getSessionWithConnection(actor, sessionId)
  }
}

export const normalizeChatStreamPayload = (payload: any): NormalizedChatStreamPayload => {
  const replyToMessageId =
    typeof payload?.replyToMessageId === 'number' ? payload.replyToMessageId : null
  const replyToClientMessageIdRaw =
    typeof payload?.replyToClientMessageId === 'string'
      ? payload.replyToClientMessageId.trim()
      : ''

  const clientMessageIdRaw =
    typeof payload?.clientMessageId === 'string' ? payload.clientMessageId.trim() : ''

  return {
    sessionId: payload?.sessionId,
    replyToMessageId,
    replyToClientMessageId: replyToClientMessageIdRaw || null,
    clientMessageId: clientMessageIdRaw || null,
    content: typeof payload?.content === 'string' ? payload.content : '',
    images: replyToMessageId || replyToClientMessageIdRaw ? undefined : payload?.images,
    traceToggle: typeof payload?.traceEnabled === 'boolean' ? payload.traceEnabled : undefined,
  }
}
