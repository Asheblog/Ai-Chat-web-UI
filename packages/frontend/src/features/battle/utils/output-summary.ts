/** Plain-text preview only; the full answer continues to use MarkdownRenderer. */
export const getOutputSummary = (output: string | null | undefined, maxLen = 100): string => {
  if (!output) return ''
  const cleaned = output
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ').trim()
  return cleaned.length <= maxLen ? cleaned : cleaned.slice(0, maxLen) + '...'
}
