const blockSplitRegex = /((?:\r?\n){2,})/
const newlineRunMatcher = /^(\r?\n){2,}$/
const mathDelimiterRegex = /(\$\$?|\\\(|\\\[)/
const mathEnvironmentRegex =
  /\\begin\{(?:aligned|align|array|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|split|equation)\}/
const greekLetterRegex =
  /\\(?:alpha|beta|gamma|delta|epsilon|theta|vartheta|lambda|mu|nu|xi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|pi)/g
const chemicalMacroRegex = /\\(?:ce|pu)\{[^}]+\}/
const generalMacroRegex = /\\[a-zA-Z]+/g
const likelyMathMacros = [
  '\\frac',
  '\\int',
  '\\sum',
  '\\sqrt',
  '\\prod',
  '\\lim',
  '\\log',
  '\\sin',
  '\\cos',
  '\\tan',
  '\\sec',
  '\\csc',
  '\\cot',
  '\\arcsin',
  '\\arccos',
  '\\arctan',
  '\\times',
  '\\cdot',
  '\\left',
  '\\right',
  '\\ln',
  '\\ce',
  '\\pu',
  '\\text',
  '\\operatorname',
  '\\begin{equation}',
]
const blockContextRegex = /^\s*(?:>|\d+\.\s|[-*+]\s)/

const hasExistingMathDelimiters = (segment: string) => mathDelimiterRegex.test(segment)
const containsCodeFence = (segment: string) => /```|~~~/ .test(segment)
const containsUrl = (segment: string) => /https?:\/\//i .test(segment)

const hasEnoughMathHints = (segment: string) => {
  if (mathEnvironmentRegex.test(segment)) return true
  const macroHits = likelyMathMacros.reduce((acc, macro) => (segment.includes(macro) ? acc + 1 : acc), 0)
  if (macroHits >= 2) return true
  if (macroHits === 0) return false
  const greekHits = (segment.match(greekLetterRegex) || []).length
  if (greekHits > 0) return true
  if (/\\frac\{[^}]+\}\{[^}]+\}/.test(segment) && (segment.includes('\\sqrt') || segment.includes('\\int') || segment.includes('\\sum'))) {
    return true
  }
  if (chemicalMacroRegex.test(segment)) return true
  const generalMacroHits = (segment.match(generalMacroRegex) || []).length
  if (generalMacroHits >= 3) return true
  if (generalMacroHits >= 2 && /[{}]/.test(segment)) return true
  const exponentOrSubscript = (segment.match(/[\^_]\s*\\?[a-zA-Z]/g) || []).length
  return exponentOrSubscript > 0
}

const shouldWrapSegment = (segment: string) => {
  const trimmed = segment.trim()
  if (!trimmed) return false
  if (blockContextRegex.test(trimmed)) return false
  if (hasExistingMathDelimiters(segment)) return false
  if (containsCodeFence(segment)) return false
  if (containsUrl(segment)) return false
  const slashCount = (segment.match(/\\/g) || []).length
  if (slashCount < 2) return false
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return true
  return hasEnoughMathHints(segment)
}

const wrapSegment = (segment: string) => {
  const leading = segment.match(/^\s*/)?.[0] ?? ''
  const trailing = segment.match(/\s*$/)?.[0] ?? ''
  const core = segment.trim()
  if (!core) return segment
  const normalizedCore = core.replace(/\r/g, '').replace(/\u00a0/g, ' ')
  return `${leading}$$\n${normalizedCore}\n$$${trailing}`
}

export const wrapBareMathBlocks = (markdown: string) => {
  if (!markdown) return markdown
  const parts = markdown.split(blockSplitRegex)
  if (parts.length === 1) {
    return shouldWrapSegment(parts[0]) ? wrapSegment(parts[0]) : markdown
  }
  const result: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i]
    if (!segment) {
      result.push(segment)
      continue
    }
    if (i % 2 === 1 && newlineRunMatcher.test(segment)) {
      result.push(segment)
      continue
    }
    result.push(shouldWrapSegment(segment) ? wrapSegment(segment) : segment)
  }
  return result.join('')
}

export const containsBareMath = (markdown: string) => wrapBareMathBlocks(markdown) !== markdown
