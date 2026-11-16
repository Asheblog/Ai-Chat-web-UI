/**
 * 挑战页（anti-bot / JS challenge）判定。
 *
 * 关键词只作辅助证据：正常技术文章提到 Cloudflare 或 CAPTCHA 时不能因此丢弃正文。
 * 结构证据（challenge-platform 脚本、challenge-form、cf-browser-verification 等）优先；
 * 只有结构或关键词成立且页面没有可用正文时，才判定为挑战页。
 */

export type ChallengeReason = 'structure' | 'thin-content'

export interface ChallengeVerdict {
  isChallenge: boolean
  reason?: ChallengeReason
  signals: string[]
  textLength: number
}

export interface ChallengeInput {
  html: string
  status?: number
  url?: string
  extractedTextLength?: number
}

const HARD_STRUCTURE_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: 'cf-chl', pattern: /(?:id|class|name)=["']?cf-chl[-_a-z]*/ },
  { signal: 'challenge-form', pattern: /id=["']?challenge-form/ },
  { signal: 'cf-browser-verification', pattern: /cf-browser-verification/ },
  { signal: 'cf_chl_opt', pattern: /_cf_chl_opt/ },
  { signal: 'challenge-running', pattern: /id=["']?challenge-running/ },
  { signal: 'cdn-cgi-refresh', pattern: /http-equiv=["']?refresh["']?[^>]+cdn-cgi/i },
]

// 正常站点也会注入 challenge-platform 脚本；只有页面没有可读正文时它才是挑战证据。
const SOFT_STRUCTURE_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: 'challenge-platform', pattern: /cdn-cgi\/challenge-platform/ },
]

const WEAK_STRUCTURE_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: 'title-just-a-moment', pattern: /<title[^>]*>\s*just a moment/i },
  { signal: 'title-attention-required', pattern: /<title[^>]*>\s*attention required/i },
  { signal: 'title-checking-browser', pattern: /<title[^>]*>[^<]*(?:checking your browser|verifying you are human|security check)/i },
  { signal: 'title-zh-verifying', pattern: /<title[^>]*>[^<]*(?:请稍候|正在验证|安全验证)/ },
]

const KEYWORD_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: 'captcha', pattern: /captcha/ },
  { signal: 'cloudflare', pattern: /cloudflare/ },
  { signal: 'enable-javascript', pattern: /enable javascript|javascript is required|turn on javascript/ },
  { signal: 'verify-human', pattern: /verify (?:that )?you are (?:a )?human|verifying you are human/ },
  { signal: 'zh-verify-human', pattern: /请验证您是人类|人机验证|验证您是人类/ },
  { signal: 'attention-required', pattern: /attention required/ },
]

const ARTICLE_CONTAINER_PATTERN = /<(?:article|main)\b[^>]*>/i
const PARAGRAPH_PATTERN = /<p\b[^>]*>/gi

const stripNonVisible = (html: string): string =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()

const countParagraphs = (html: string): number => {
  const matches = html.match(PARAGRAPH_PATTERN)
  return matches ? matches.length : 0
}

export function classifyChallenge(input: ChallengeInput): ChallengeVerdict {
  const html = input.html || ''
  const normalized = html.toLowerCase()
  const signals: string[] = []
  if (!normalized.trim()) {
    return { isChallenge: false, signals, textLength: 0 }
  }

  const visibleText = stripNonVisible(html)
  const textLength = typeof input.extractedTextLength === 'number'
    ? input.extractedTextLength
    : visibleText.length
  const paragraphCount = countParagraphs(html)
  const hasArticleBody = ARTICLE_CONTAINER_PATTERN.test(html) && paragraphCount >= 3 && textLength >= 400

  const strongSignals: string[] = []
  for (const { signal, pattern } of HARD_STRUCTURE_PATTERNS) {
    if (pattern.test(normalized)) strongSignals.push(signal)
  }
  const softSignals: string[] = []
  for (const { signal, pattern } of SOFT_STRUCTURE_PATTERNS) {
    if (pattern.test(normalized)) softSignals.push(signal)
  }
  const weakSignals: string[] = []
  for (const { signal, pattern } of WEAK_STRUCTURE_PATTERNS) {
    if (pattern.test(html)) weakSignals.push(signal)
  }
  const keywordSignals: string[] = []
  for (const { signal, pattern } of KEYWORD_PATTERNS) {
    if (pattern.test(normalized)) keywordSignals.push(signal)
  }

  if (strongSignals.length > 0) {
    signals.push(...strongSignals)
    return { isChallenge: true, reason: 'structure', signals, textLength }
  }

  if (softSignals.length > 0) {
    signals.push(...softSignals)
    const hasReadableBody = hasArticleBody || (textLength >= 800 && paragraphCount >= 3)
    if (!hasReadableBody) {
      return { isChallenge: true, reason: 'structure', signals, textLength }
    }
  }

  if (weakSignals.length > 0) {
    signals.push(...weakSignals)
    const hasReadableBody = hasArticleBody || (textLength >= 800 && paragraphCount >= 3)
    if (!hasReadableBody) {
      return { isChallenge: true, reason: 'structure', signals, textLength }
    }
    return { isChallenge: false, signals, textLength }
  }

  if (keywordSignals.length > 0) {
    signals.push(...keywordSignals)
    const thinContent = textLength < 400 && paragraphCount < 2 && !hasArticleBody
    if (thinContent) {
      return { isChallenge: true, reason: 'thin-content', signals, textLength }
    }
  }

  return { isChallenge: false, signals, textLength }
}
