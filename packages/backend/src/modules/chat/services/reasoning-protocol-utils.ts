/**
 * Provider-agnostic reasoning protocol helpers extracted from the chat stream
 * use case so the streaming pipeline and tests can share them without
 * importing the full SSE orchestration file.
 */

export const detectChatReasoningSignal = (
  payload: any,
):
  | 'delta.reasoning_content'
  | 'delta.reasoning'
  | 'delta.thinking'
  | 'delta.analysis'
  | null => {
  if (typeof payload?.choices?.[0]?.delta?.reasoning_content === 'string') {
    return 'delta.reasoning_content'
  }
  if (typeof payload?.choices?.[0]?.delta?.reasoning === 'string') {
    return 'delta.reasoning'
  }
  if (typeof payload?.choices?.[0]?.delta?.thinking === 'string') {
    return 'delta.thinking'
  }
  if (typeof payload?.choices?.[0]?.delta?.analysis === 'string') {
    return 'delta.analysis'
  }
  if (typeof payload?.delta?.reasoning_content === 'string') {
    return 'delta.reasoning_content'
  }
  if (typeof payload?.delta?.reasoning === 'string') {
    return 'delta.reasoning'
  }
  if (typeof payload?.message?.reasoning_content === 'string') {
    return 'delta.reasoning_content'
  }
  if (typeof payload?.message?.reasoning === 'string') {
    return 'delta.reasoning'
  }
  if (typeof payload?.reasoning === 'string') {
    return 'delta.reasoning'
  }
  if (typeof payload?.analysis === 'string') {
    return 'delta.analysis'
  }
  return null
}

export const isResponsesUnsupportedFallback = (
  statusCode: number,
  bodyText: string,
): boolean => {
  if (statusCode === 404 || statusCode === 405 || statusCode === 501) return true
  if (statusCode !== 400) return false
  const message = bodyText.toLowerCase()
  return (
    message.includes('/responses') ||
    message.includes('responses') ||
    message.includes('unknown endpoint') ||
    message.includes('not found')
  )
}
