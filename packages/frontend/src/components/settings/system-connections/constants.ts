export const CONNECTION_CAP_KEYS = ['vision', 'image_generation'] as const
export type ConnectionCapKey = typeof CONNECTION_CAP_KEYS[number]

export const CONNECTION_CAP_LABELS: Record<ConnectionCapKey, string> = {
  vision: '图片理解（Vision）',
  image_generation: '图像生成',
}

export const createEmptyConnectionCaps = (): Record<ConnectionCapKey, boolean> => ({
  vision: false,
  image_generation: false,
})

export const parseConnectionCaps = (raw?: string | null): Record<ConnectionCapKey, boolean> => {
  const next = createEmptyConnectionCaps()
  if (!raw) return next
  try {
    const parsed = JSON.parse(raw || '{}')
    CONNECTION_CAP_KEYS.forEach((key) => {
      next[key] = Boolean(parsed?.[key])
    })
  } catch {
    // ignore parse error，使用默认值
  }
  return next
}
