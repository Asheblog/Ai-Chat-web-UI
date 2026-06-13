/**
 * 工作区文件 manifest 构造纯函数
 */

/** 标准化工作区文件路径：反斜杠→正斜杠，确保以 /workspace/ 开头 */
export const toWorkspaceSandboxPath = (workspacePath: string): string => {
  const normalized = workspacePath.replace(/\\/g, '/')
  if (normalized.startsWith('/workspace/')) return normalized
  if (normalized.startsWith('/')) return `/workspace${normalized}`
  return `/workspace/${normalized}`
}

interface FileEntry {
  originalName: string
  workspacePath: string
}

/**
 * 构造工作区文件 manifest 文本。
 * 空数组返回空串；非空返回含文件清单和 Python 提示的多行文本。
 */
export const buildWorkspaceFileManifest = (files: FileEntry[]): string => {
  if (files.length === 0) return ''
  const lines = files.map(
    (f) => `- ${f.originalName} → ${toWorkspaceSandboxPath(f.workspacePath)}`,
  )
  return `\n\n已上传工作区文件（可使用 Python 读取）：\n${lines.join('\n')}`
}
