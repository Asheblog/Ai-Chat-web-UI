import { streamMetaStore, STREAMING_PLACEHOLDER_STATUSES } from '../../services/chat/stream-meta-store'
export type {
  AgentStreamMeta,
  StreamMetaRegistrationParams,
} from '../../services/chat/stream-meta-store'

export const buildAgentStreamKey = streamMetaStore.buildAgentStreamKey.bind(streamMetaStore)
export const deriveAssistantClientMessageId = streamMetaStore.deriveAssistantClientMessageId.bind(streamMetaStore)
export const ensureAssistantClientMessageId = streamMetaStore.ensureAssistantClientMessageId.bind(streamMetaStore)
export const resolveAssistantClientIdFromRequest = streamMetaStore.resolveAssistantClientIdFromRequest.bind(streamMetaStore)
export const registerStreamMeta = streamMetaStore.registerStreamMeta.bind(streamMetaStore)
export const updateStreamMetaController = streamMetaStore.updateStreamMetaController.bind(streamMetaStore)
export const persistStreamMeta = streamMetaStore.persistStreamMeta.bind(streamMetaStore)
export const releaseStreamMeta = streamMetaStore.releaseStreamMeta.bind(streamMetaStore)
export const findStreamMetaByMessageId = streamMetaStore.findStreamMetaByMessageId.bind(streamMetaStore)
export const findStreamMetaByClientMessageId = streamMetaStore.findStreamMetaByClientMessageId.bind(streamMetaStore)
export const findStreamMetaByAssistantClientMessageId = streamMetaStore.findStreamMetaByAssistantClientMessageId.bind(streamMetaStore)
export const getStreamMetaByKey = streamMetaStore.getStreamMetaByKey.bind(streamMetaStore)
export const buildPendingCancelKeyByClientId = streamMetaStore.buildPendingCancelKeyByClientId.bind(streamMetaStore)
export const buildPendingCancelKeyByMessageId = streamMetaStore.buildPendingCancelKeyByMessageId.bind(streamMetaStore)
export const registerPendingCancelMarker = streamMetaStore.registerPendingCancelMarker.bind(streamMetaStore)
export const clearPendingCancelMarkers = streamMetaStore.clearPendingCancelMarkers.bind(streamMetaStore)
export const hasPendingStreamCancelKey = streamMetaStore.hasPendingStreamCancelKey.bind(streamMetaStore)
export const deletePendingStreamCancelKey = streamMetaStore.deletePendingStreamCancelKey.bind(streamMetaStore)
export { STREAMING_PLACEHOLDER_STATUSES, streamMetaStore }
