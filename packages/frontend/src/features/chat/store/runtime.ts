import type {
  ChatStoreGetState,
  ChatStoreRuntime,
  ChatStoreSetState,
} from './types'

import {
  getSessionCompletionSnapshots,
  persistCompletionSnapshot,
  removeCompletionSnapshot,
  snapshotDebug,
} from './runtime/snapshot-store'
import { createStreamStateRuntime } from './runtime/stream-state'
import { createProgressWatcherRuntime } from './runtime/progress-watcher'
import { createSnapshotPersistRuntime } from './runtime/snapshot-persist'
import { createBufferedSnapshotApplier } from './runtime/buffered-snapshots'
import { createServerMessageApplier } from './runtime/server-message'
import { createMetaStatusUpdater } from './runtime/meta-status'
import { createStreamBufferRuntime } from './runtime/stream-buffer'

export const createChatStoreRuntime = (
  set: ChatStoreSetState,
  get: ChatStoreGetState,
): ChatStoreRuntime => {
  const streamState = createStreamStateRuntime(set, get)
  const {
    activeStreams,
    registerActiveStream,
    unregisterActiveStream,
    findStreamByAssistantId,
    findStreamByClientMessageId,
    recomputeStreamingState,
    streamingFlagUpdate,
  } = streamState

  const { persistSnapshotForStream } = createSnapshotPersistRuntime(get)
  const { applyBufferedSnapshots } = createBufferedSnapshotApplier(set, get)
  const { applyServerMessageSnapshot } = createServerMessageApplier(set, get)

  const progressWatcher = createProgressWatcherRuntime({
    get,
    findStreamByAssistantId,
    applyServerMessageSnapshot,
  })
  const {
    streamingPollers,
    stopMessagePoller,
    stopAllMessagePollers,
    startMessageProgressWatcher,
  } = progressWatcher

  const { updateMetaStreamStatus } = createMetaStatusUpdater(set, stopMessagePoller)
  const { flushStreamBuffer, scheduleFlush, clearActiveStream } = createStreamBufferRuntime({
    set,
    unregisterActiveStream,
    persistSnapshotForStream,
  })

  return {
    activeStreams,
    streamingPollers,
    registerActiveStream,
    unregisterActiveStream,
    findStreamByAssistantId,
    findStreamByClientMessageId,
    stopMessagePoller,
    stopAllMessagePollers,
    persistSnapshotForStream,
    persistCompletionRecord: persistCompletionSnapshot,
    recomputeStreamingState,
    streamingFlagUpdate,
    applyBufferedSnapshots,
    applyServerMessageSnapshot,
    updateMetaStreamStatus,
    startMessageProgressWatcher,
    flushStreamBuffer,
    scheduleFlush,
    clearActiveStream,
    removeCompletionSnapshot,
    getSessionCompletionSnapshots,
    snapshotDebug,
  }
}
