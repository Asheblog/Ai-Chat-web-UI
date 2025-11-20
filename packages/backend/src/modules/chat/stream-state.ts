import {
  streamMetaStore as defaultStreamMetaStore,
  STREAMING_PLACEHOLDER_STATUSES,
  type StreamMetaStore,
} from '../../services/chat/stream-meta-store'
export type {
  AgentStreamMeta,
  StreamMetaRegistrationParams,
} from '../../services/chat/stream-meta-store'

let streamMetaStore: StreamMetaStore = defaultStreamMetaStore

export const setStreamMetaStore = (store: StreamMetaStore) => {
  streamMetaStore = store
}

export const buildAgentStreamKey = (...args: Parameters<StreamMetaStore['buildAgentStreamKey']>) =>
  streamMetaStore.buildAgentStreamKey(...args)

export const deriveAssistantClientMessageId = (...args: Parameters<StreamMetaStore['deriveAssistantClientMessageId']>) =>
  streamMetaStore.deriveAssistantClientMessageId(...args)

export const ensureAssistantClientMessageId = (...args: Parameters<StreamMetaStore['ensureAssistantClientMessageId']>) =>
  streamMetaStore.ensureAssistantClientMessageId(...args)

export const resolveAssistantClientIdFromRequest = (...args: Parameters<StreamMetaStore['resolveAssistantClientIdFromRequest']>) =>
  streamMetaStore.resolveAssistantClientIdFromRequest(...args)

export const registerStreamMeta = (...args: Parameters<StreamMetaStore['registerStreamMeta']>) =>
  streamMetaStore.registerStreamMeta(...args)

export const updateStreamMetaController = (...args: Parameters<StreamMetaStore['updateStreamMetaController']>) =>
  streamMetaStore.updateStreamMetaController(...args)

export const persistStreamMeta = (...args: Parameters<StreamMetaStore['persistStreamMeta']>) =>
  streamMetaStore.persistStreamMeta(...args)

export const releaseStreamMeta = (...args: Parameters<StreamMetaStore['releaseStreamMeta']>) =>
  streamMetaStore.releaseStreamMeta(...args)

export const findStreamMetaByMessageId = (...args: Parameters<StreamMetaStore['findStreamMetaByMessageId']>) =>
  streamMetaStore.findStreamMetaByMessageId(...args)

export const findStreamMetaByClientMessageId = (...args: Parameters<StreamMetaStore['findStreamMetaByClientMessageId']>) =>
  streamMetaStore.findStreamMetaByClientMessageId(...args)

export const findStreamMetaByAssistantClientMessageId = (...args: Parameters<StreamMetaStore['findStreamMetaByAssistantClientMessageId']>) =>
  streamMetaStore.findStreamMetaByAssistantClientMessageId(...args)

export const getStreamMetaByKey = (...args: Parameters<StreamMetaStore['getStreamMetaByKey']>) =>
  streamMetaStore.getStreamMetaByKey(...args)

export const buildPendingCancelKeyByClientId = (...args: Parameters<StreamMetaStore['buildPendingCancelKeyByClientId']>) =>
  streamMetaStore.buildPendingCancelKeyByClientId(...args)

export const buildPendingCancelKeyByMessageId = (...args: Parameters<StreamMetaStore['buildPendingCancelKeyByMessageId']>) =>
  streamMetaStore.buildPendingCancelKeyByMessageId(...args)

export const registerPendingCancelMarker = (...args: Parameters<StreamMetaStore['registerPendingCancelMarker']>) =>
  streamMetaStore.registerPendingCancelMarker(...args)

export const clearPendingCancelMarkers = (...args: Parameters<StreamMetaStore['clearPendingCancelMarkers']>) =>
  streamMetaStore.clearPendingCancelMarkers(...args)

export const hasPendingStreamCancelKey = (...args: Parameters<StreamMetaStore['hasPendingStreamCancelKey']>) =>
  streamMetaStore.hasPendingStreamCancelKey(...args)

export const deletePendingStreamCancelKey = (...args: Parameters<StreamMetaStore['deletePendingStreamCancelKey']>) =>
  streamMetaStore.deletePendingStreamCancelKey(...args)

export { STREAMING_PLACEHOLDER_STATUSES, streamMetaStore }
