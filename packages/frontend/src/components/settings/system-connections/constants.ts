export const CONNECTION_CAP_KEYS = ['vision', 'file_upload', 'web_search', 'image_generation', 'code_interpreter'] as const
export type ConnectionCapKey = typeof CONNECTION_CAP_KEYS[number]

export const CONNECTION_CAP_LABELS: Record<ConnectionCapKey, string> = {
  vision: '图片理解（Vision）',
  file_upload: '文件上传',
  web_search: '联网搜索',
  image_generation: '图像生成',
  code_interpreter: '代码解释器',
}

export const createEmptyConnectionCaps = (): Record<ConnectionCapKey, boolean> => ({
  vision: false,
  file_upload: false,
  web_search: false,
  image_generation: false,
  code_interpreter: false,
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
