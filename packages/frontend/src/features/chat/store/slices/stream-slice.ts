import type { StreamSlice } from '../types'
import type { ChatSliceCreator } from '../types'
import { createStreamMessageAction } from './stream-message'
import { createStopStreamingAction } from './stream-stop'

export const createStreamSlice: ChatSliceCreator<
  StreamSlice & {
    isStreaming: boolean
    activeStreamSessionId: number | null
    streamingSessions: Record<number, number>
    activeStreamCount: number
  }
> = (set, get, runtime) => ({
  isStreaming: false,
  activeStreamSessionId: null,
  streamingSessions: {},
  activeStreamCount: 0,

  sendMessage: async (sessionId: number, content: string) => {
    await get().streamMessage(sessionId, content)
  },

  streamMessage: createStreamMessageAction(set, get, runtime),
  stopStreaming: createStopStreamingAction(set, get, runtime),
})
