import { randomUUID } from 'node:crypto';
import type { Message } from '../../types';

export type AgentStreamMeta = {
  sessionId: number;
  actorId: string;
  controller: AbortController | null;
  cancelled: boolean;
  clientMessageId: string | null;
  assistantClientMessageId: string | null;
  assistantMessageId: number | string | null;
  streamKey: string;
};

export type StreamMetaRegistrationParams = {
  sessionId: number;
  actorIdentifier: string;
  clientMessageId?: string | null;
  assistantClientMessageId?: string | null;
  assistantMessageId?: number | string | null;
};

const agentStreamControllers = new Map<string, AgentStreamMeta>();
const pendingStreamCancels = new Set<string>();

export const buildAgentStreamKey = (
  sessionId: number,
  clientMessageId?: string | null,
  messageId?: number | string | null,
) => {
  if (clientMessageId && clientMessageId.trim()) {
    return `client:${clientMessageId.trim()}`;
  }
  if (typeof messageId === 'number' || typeof messageId === 'string') {
    return `session:${sessionId}:${messageId}`;
  }
  return `session:${sessionId}`;
};

export const deriveAssistantClientMessageId = (clientMessageId?: string | null) => {
  if (typeof clientMessageId === 'string' && clientMessageId.trim().length > 0) {
    const candidate = `${clientMessageId.trim()}:assistant`;
    return candidate.length > 120 ? candidate.slice(0, 120) : candidate;
  }
  return `assistant:${randomUUID()}`;
};

export const ensureAssistantClientMessageId = (value?: string | null): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
    }
  }
  return deriveAssistantClientMessageId(null);
};

export const resolveAssistantClientIdFromRequest = (value?: string | null) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith(':assistant')) {
    return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
  }
  return deriveAssistantClientMessageId(trimmed);
};

export const registerStreamMeta = (params: StreamMetaRegistrationParams): AgentStreamMeta | null => {
  const { sessionId, actorIdentifier, clientMessageId, assistantClientMessageId, assistantMessageId } = params;
  const key = buildAgentStreamKey(sessionId, clientMessageId ?? null, assistantMessageId ?? null);
  if (!key) return null;
  const meta: AgentStreamMeta = {
    sessionId,
    actorId: actorIdentifier,
    controller: null,
    cancelled: false,
    clientMessageId: clientMessageId ?? null,
    assistantClientMessageId: assistantClientMessageId ?? null,
    assistantMessageId: assistantMessageId ?? null,
    streamKey: key,
  };
  agentStreamControllers.set(key, meta);
  return meta;
};

export const updateStreamMetaController = (meta: AgentStreamMeta | null, controller: AbortController | null) => {
  if (!meta) return;
  meta.controller = controller;
  agentStreamControllers.set(meta.streamKey, meta);
};

export const persistStreamMeta = (meta: AgentStreamMeta | null) => {
  if (!meta) return;
  agentStreamControllers.set(meta.streamKey, meta);
};

export const releaseStreamMeta = (meta: AgentStreamMeta | null) => {
  if (!meta) return;
  agentStreamControllers.delete(meta.streamKey);
  meta.controller = null;
};

export const findStreamMetaByMessageId = (
  sessionId: number,
  messageId?: number | string | null,
): AgentStreamMeta | null => {
  if (messageId == null) return null;
  const target = String(messageId);
  for (const meta of agentStreamControllers.values()) {
    if (meta.sessionId === sessionId && meta.assistantMessageId != null && String(meta.assistantMessageId) === target) {
      return meta;
    }
  }
  return null;
};

export const findStreamMetaByClientMessageId = (
  sessionId: number,
  clientMessageId?: string | null,
): AgentStreamMeta | null => {
  if (!clientMessageId) return null;
  for (const meta of agentStreamControllers.values()) {
    if (meta.sessionId === sessionId && meta.clientMessageId === clientMessageId) {
      return meta;
    }
  }
  return null;
};

export const findStreamMetaByAssistantClientMessageId = (
  sessionId: number,
  assistantClientMessageId?: string | null,
): AgentStreamMeta | null => {
  if (!assistantClientMessageId) return null;
  const target = assistantClientMessageId.trim();
  if (!target) return null;
  for (const meta of agentStreamControllers.values()) {
    if (meta.sessionId === sessionId && meta.assistantClientMessageId === target) {
      return meta;
    }
  }
  return null;
};

export const getStreamMetaByKey = (key: string | null | undefined): AgentStreamMeta | null => {
  if (!key) return null;
  return agentStreamControllers.get(key) ?? null;
};

export const buildPendingCancelKeyByClientId = (sessionId: number, clientMessageId?: string | null) => {
  if (typeof clientMessageId === 'string') {
    const trimmed = clientMessageId.trim();
    if (trimmed.length > 0) {
      return `session:${sessionId}:client:${trimmed}`;
    }
  }
  return null;
};

export const buildPendingCancelKeyByMessageId = (sessionId: number, messageId?: number | string | null) => {
  if (typeof messageId === 'number' || typeof messageId === 'string') {
    return `session:${sessionId}:message:${messageId}`;
  }
  return null;
};

export const registerPendingCancelMarker = (params: {
  sessionId: number;
  messageId?: number | string | null;
  clientMessageId?: string | null;
  assistantClientMessageId?: string | null;
}) => {
  const { sessionId, messageId, clientMessageId, assistantClientMessageId } = params;
  let registered = false;
  const keyByMessage = buildPendingCancelKeyByMessageId(sessionId, messageId);
  if (keyByMessage) {
    pendingStreamCancels.add(keyByMessage);
    registered = true;
  }
  const rawClientKey = buildPendingCancelKeyByClientId(sessionId, clientMessageId);
  if (rawClientKey) {
    pendingStreamCancels.add(rawClientKey);
    registered = true;
  }
  const assistantKey = buildPendingCancelKeyByClientId(sessionId, assistantClientMessageId);
  if (assistantKey) {
    pendingStreamCancels.add(assistantKey);
    registered = true;
  } else if (clientMessageId) {
    const derivedAssistant = resolveAssistantClientIdFromRequest(clientMessageId);
    if (derivedAssistant) {
      const derivedKey = buildPendingCancelKeyByClientId(sessionId, derivedAssistant);
      if (derivedKey) {
        pendingStreamCancels.add(derivedKey);
        registered = true;
      }
    }
  }
  return registered;
};

export const clearPendingCancelMarkers = (params: {
  sessionId: number;
  messageId?: number | string | null;
  clientMessageId?: string | null;
  assistantClientMessageId?: string | null;
}) => {
  const { sessionId, messageId, clientMessageId, assistantClientMessageId } = params;
  const keys = [
    buildPendingCancelKeyByMessageId(sessionId, messageId),
    buildPendingCancelKeyByClientId(sessionId, clientMessageId),
    buildPendingCancelKeyByClientId(sessionId, assistantClientMessageId),
  ].filter(Boolean) as string[];
  for (const key of keys) {
    pendingStreamCancels.delete(key);
  }
};

export const hasPendingStreamCancelKey = (key: string | null | undefined) => {
  if (!key) return false;
  return pendingStreamCancels.has(key);
};

export const deletePendingStreamCancelKey = (key: string | null | undefined) => {
  if (!key) return;
  pendingStreamCancels.delete(key);
};

export const STREAMING_PLACEHOLDER_STATUSES: Array<NonNullable<Message['streamStatus']>> = ['pending', 'streaming'];
