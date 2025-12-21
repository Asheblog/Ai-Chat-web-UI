export const safeJsonStringify = (value: unknown, fallback: string) => {
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

export const safeParseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
