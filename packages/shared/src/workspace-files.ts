/**
 * 工作区文件的共享常量和类型
 */

/** 单文件上传大小上限（字节），需与后端校验一致 */
export const MAX_WORKSPACE_FILE_SIZE = 100 * 1024 * 1024 // 100MB

/** 推荐文件类型列表（用于前端提示，非后端白名单） */
export const RECOMMENDED_FILE_TYPES = [
  'PDF',
  'Word',
  'Excel',
  'CSV',
  '纯文本 / Markdown',
  'JSON',
  '代码文件',
] as const

/** 上传限制文案 */
export const FILE_SIZE_LIMIT_LABEL = `单文件最大 ${Math.round(MAX_WORKSPACE_FILE_SIZE / 1024 / 1024)}MB`
