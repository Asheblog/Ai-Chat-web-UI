export type ResponsesStreamEventExtraction =
  | {
      kind: 'delta'
      contentDelta?: string
      reasoningDelta?: string
    }
  | {
      kind: 'done'
      status: 'completed' | 'failed' | 'incomplete'
      response: any
      usage?: any
    }
  | {
      kind: 'ignored'
    }

export function isOpenAIResponsesStreamEvent(payload: any): boolean {
  return typeof payload?.type === 'string' && payload.type.startsWith('response.')
}

export function extractOpenAIResponsesStreamEvent(payload: any): ResponsesStreamEventExtraction | null {
  if (!isOpenAIResponsesStreamEvent(payload)) return null
  const type = payload.type as string

  if (type === 'response.output_text.delta') {
    return {
      kind: 'delta',
      contentDelta: typeof payload?.delta === 'string' ? payload.delta : '',
    }
  }

  if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') {
    return {
      kind: 'delta',
      reasoningDelta: typeof payload?.delta === 'string' ? payload.delta : '',
    }
  }

  if (type === 'response.completed' || type === 'response.failed' || type === 'response.incomplete') {
    const status =
      type === 'response.completed' ? 'completed' : type === 'response.failed' ? 'failed' : 'incomplete'
    const response = payload?.response ?? null
    return {
      kind: 'done',
      status,
      response,
      usage: response?.usage ?? null,
    }
  }

  return { kind: 'ignored' }
}

function normalizeRole(role: unknown): 'user' | 'assistant' | 'system' | 'developer' {
  const r = (typeof role === 'string' ? role : '').toLowerCase()
  if (r === 'assistant') return 'assistant'
  if (r === 'system') return 'system'
  if (r === 'developer') return 'developer'
  return 'user'
}

function toInputParts(
  content: any,
): Array<{ type: 'input_text'; text: string } | { type: 'input_image'; detail: 'auto'; image_url?: string | null }> {
  if (typeof content === 'string') {
    const text = content
    return text ? [{ type: 'input_text', text }] : []
  }
  if (!Array.isArray(content)) return []
  const parts: Array<
    { type: 'input_text'; text: string } | { type: 'input_image'; detail: 'auto'; image_url?: string | null }
  > = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      parts.push({ type: 'input_text', text: part.text })
      continue
    }
    if (part.type === 'image_url') {
      const url = part?.image_url?.url
      if (typeof url === 'string' && url) {
        parts.push({ type: 'input_image', detail: 'auto', image_url: url })
      }
      continue
    }
  }
  return parts
}

export function convertChatCompletionsMessagesToResponsesInput(messages: any[]): any[] {
  const input: any[] = []
  const list = Array.isArray(messages) ? messages : []

  for (const msg of list) {
    if (!msg || typeof msg !== 'object') continue
    const role = normalizeRole(msg.role)

    if (msg.role === 'tool' || role === 'user' && msg.tool_call_id) {
      const callId = msg.tool_call_id
      if (typeof callId === 'string' && callId) {
        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? ''),
        })
      }
      continue
    }

    const parts = toInputParts(msg.content)
    if (parts.length > 0) {
      input.push({
        type: 'message',
        role,
        content: parts,
      })
    }

    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
    for (const call of toolCalls) {
      const callId = typeof call?.id === 'string' ? call.id : null
      const name = typeof call?.function?.name === 'string' ? call.function.name : null
      const args = typeof call?.function?.arguments === 'string' ? call.function.arguments : ''
      if (!callId || !name) continue
      input.push({
        type: 'function_call',
        call_id: callId,
        name,
        arguments: args || '',
      })
    }
  }

  return input
}

export function convertChatCompletionsRequestToResponses(requestBody: any): any {
  const body = requestBody && typeof requestBody === 'object' ? { ...requestBody } : {}
  const messages = Array.isArray(body.messages) ? body.messages : []

  const maxOutputTokens =
    body.max_output_tokens ??
    body.max_tokens ??
    body.max_completion_tokens ??
    undefined

  const reasoningEffort = body.reasoning_effort

  const next: any = {
    model: body.model,
    input: convertChatCompletionsMessagesToResponsesInput(messages),
    stream: Boolean(body.stream),
    temperature: body.temperature,
    top_p: body.top_p,
    metadata: body.metadata,
    tools: body.tools,
    tool_choice: body.tool_choice,
    parallel_tool_calls: body.parallel_tool_calls,
  }

  if (typeof maxOutputTokens === 'number') {
    next.max_output_tokens = maxOutputTokens
  }

  if (typeof reasoningEffort === 'string' && reasoningEffort.trim()) {
    next.reasoning = { effort: reasoningEffort.trim() }
  }

  return next
}

export function extractTextFromResponsesResponse(response: any): string {
  const output = Array.isArray(response?.output) ? response.output : []
  let text = ''
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    if (item.type !== 'message' || item.role !== 'assistant') continue
    const content = Array.isArray(item.content) ? item.content : []
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        text += part.text
      }
    }
  }
  return text
}

export function extractReasoningFromResponsesResponse(response: any): string | null {
  const output = Array.isArray(response?.output) ? response.output : []
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    if (item.type !== 'reasoning') continue
    const summary = Array.isArray(item.summary) ? item.summary : []
    for (const s of summary) {
      if (s?.type === 'summary_text' && typeof s.text === 'string' && s.text.trim()) {
        chunks.push(s.text.trim())
      }
    }
    const content = Array.isArray(item.content) ? item.content : []
    for (const c of content) {
      if (c?.type === 'reasoning_text' && typeof c.text === 'string' && c.text.trim()) {
        chunks.push(c.text.trim())
      }
    }
  }
  const joined = chunks.join('\n').trim()
  return joined ? joined : null
}

