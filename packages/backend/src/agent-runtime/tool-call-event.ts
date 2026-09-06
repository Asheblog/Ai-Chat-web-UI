const TOOL_CALL_PHASES = new Set([
  'arguments_streaming',
  'pending_approval',
  'executing',
  'result',
  'error',
  'rejected',
  'aborted',
]);

const TOOL_CALL_STATUSES = new Set([
  'running',
  'success',
  'error',
  'pending',
  'rejected',
  'aborted',
]);

const TOOL_CALL_SOURCES = new Set(['builtin', 'plugin', 'mcp', 'workspace', 'system']);

const LEGACY_TOOL_STAGES = new Set(['start', 'result', 'error']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const pickString = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
};

const resolvePhase = (
  phase: unknown,
  status: unknown,
  stage: unknown,
): string => {
  if (typeof phase === 'string' && TOOL_CALL_PHASES.has(phase)) {
    return phase;
  }
  if (status === 'pending') return 'pending_approval';
  if (status === 'success') return 'result';
  if (status === 'rejected') return 'rejected';
  if (status === 'aborted') return 'aborted';
  if (status === 'error') return 'error';
  if (status === 'running') return 'executing';
  if (stage === 'result') return 'result';
  if (stage === 'error') return 'error';
  return 'executing';
};

const resolveLegacyStage = (stage: unknown, phase: string): 'start' | 'result' | 'error' => {
  if (typeof stage === 'string' && LEGACY_TOOL_STAGES.has(stage)) {
    return stage as 'start' | 'result' | 'error';
  }
  if (phase === 'result') return 'result';
  if (phase === 'error' || phase === 'rejected' || phase === 'aborted') return 'error';
  return 'start';
};

const resolveStatus = (status: unknown, phase: string, stage: 'start' | 'result' | 'error'): string => {
  if (typeof status === 'string' && TOOL_CALL_STATUSES.has(status)) {
    return status;
  }
  if (phase === 'pending_approval') return 'pending';
  if (phase === 'result') return 'success';
  if (phase === 'rejected') return 'rejected';
  if (phase === 'aborted') return 'aborted';
  if (phase === 'error') return 'error';
  if (stage === 'result') return 'success';
  if (stage === 'error') return 'error';
  return 'running';
};

const resolveSource = (source: unknown): string => {
  if (typeof source === 'string' && TOOL_CALL_SOURCES.has(source)) {
    return source;
  }
  return 'builtin';
};

export const normalizeToolCallEventPayload = (
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const details = isRecord(payload.details) ? payload.details : null;
  const callId = pickString(payload.callId, payload.id);
  const phase = resolvePhase(payload.phase, payload.status, payload.stage);
  const stage = resolveLegacyStage(payload.stage, phase);
  const status = resolveStatus(payload.status, phase, stage);
  const identifier = pickString(payload.identifier, payload.tool, payload.apiName) || 'tool';
  const apiName = pickString(payload.apiName, payload.identifier, payload.tool) || identifier;
  const source = resolveSource(payload.source);

  const normalized: Record<string, unknown> = {
    ...payload,
    type: 'tool_call',
    id: pickString(payload.id, callId) || undefined,
    callId: callId || undefined,
    source,
    identifier,
    apiName,
    phase,
    stage,
    status,
  };

  if (!pickString(payload.argumentsText) && details) {
    const argumentsText = pickString(details.argumentsText, details.input, details.code);
    if (argumentsText) normalized.argumentsText = argumentsText;
  }
  if (typeof payload.argumentsPatch !== 'string' && details && typeof details.argumentsPatch === 'string') {
    normalized.argumentsPatch = details.argumentsPatch;
  }
  if (!pickString(payload.resultText) && details) {
    const resultText = pickString(details.resultText, details.stdout, details.excerpt);
    if (resultText) normalized.resultText = resultText;
  }
  if (typeof payload.resultJson === 'undefined' && details && typeof details.resultJson !== 'undefined') {
    normalized.resultJson = details.resultJson;
  }
  if (typeof payload.warning !== 'string' && details && typeof details.warning === 'string') {
    normalized.warning = details.warning;
  }

  return normalized;
};
