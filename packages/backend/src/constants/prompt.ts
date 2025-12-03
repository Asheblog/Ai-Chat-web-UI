const DEFAULT_MAX_SYSTEM_PROMPT_LENGTH = 12000
const MAX_SYSTEM_PROMPT_LENGTH_CAP = 100000

const parseEnvLength = (value?: string | null) => {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return Math.min(parsed, MAX_SYSTEM_PROMPT_LENGTH_CAP)
}

export const MAX_SYSTEM_PROMPT_LENGTH =
  parseEnvLength(process.env.SYSTEM_PROMPT_MAX_LENGTH) ??
  parseEnvLength(process.env.SESSION_PROMPT_MAX_CHARS) ??
  parseEnvLength(process.env.CHAT_SYSTEM_PROMPT_MAX_CHARS) ??
  DEFAULT_MAX_SYSTEM_PROMPT_LENGTH
