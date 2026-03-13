type PruneResult = {
  changed: boolean
  removedAssistantCalls: number
  removedToolMessages: number
}

const MISSING_TOOL_CALL_OUTPUT_REGEX =
  /No tool call found for function call output with call_id\s+([A-Za-z0-9_-]+)/i

const extractStringPayload = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

export function extractMissingFunctionCallOutputId(error: unknown): string | null {
  const candidateTexts = [
    extractStringPayload((error as any)?.message),
    extractStringPayload((error as any)?.payload?.error?.message),
    extractStringPayload((error as any)?.payload),
    extractStringPayload(error),
  ]

  for (const text of candidateTexts) {
    if (!text) continue
    const match = text.match(MISSING_TOOL_CALL_OUTPUT_REGEX)
    if (match && typeof match[1] === 'string' && match[1].trim()) {
      return match[1].trim()
    }
  }

  return null
}

export function pruneMissingToolCallReferences(messages: any[], callId: string): PruneResult {
  if (!Array.isArray(messages) || !callId || !callId.trim()) {
    return {
      changed: false,
      removedAssistantCalls: 0,
      removedToolMessages: 0,
    }
  }

  const targetId = callId.trim()
  let changed = false
  let removedAssistantCalls = 0
  let removedToolMessages = 0

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || typeof message !== 'object') continue

    if (message.role === 'tool') {
      const messageToolCallId =
        typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : ''
      if (messageToolCallId === targetId) {
        messages.splice(i, 1)
        changed = true
        removedToolMessages += 1
      }
      continue
    }

    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) {
      continue
    }

    const originalToolCalls = message.tool_calls
    const filteredToolCalls = originalToolCalls.filter((toolCall: any) => {
      const toolCallId = typeof toolCall?.id === 'string' ? toolCall.id.trim() : ''
      return toolCallId !== targetId
    })

    const removedCount = originalToolCalls.length - filteredToolCalls.length
    if (removedCount <= 0) {
      continue
    }

    changed = true
    removedAssistantCalls += removedCount

    if (filteredToolCalls.length > 0) {
      message.tool_calls = filteredToolCalls
      continue
    }

    const hasContent =
      (typeof message.content === 'string' && message.content.trim().length > 0) ||
      (message.content !== null && typeof message.content !== 'undefined')
    const hasReasoning =
      typeof message.reasoning_content === 'string' && message.reasoning_content.trim().length > 0

    if (!hasContent && !hasReasoning) {
      messages.splice(i, 1)
      continue
    }

    delete message.tool_calls
  }

  return {
    changed,
    removedAssistantCalls,
    removedToolMessages,
  }
}
