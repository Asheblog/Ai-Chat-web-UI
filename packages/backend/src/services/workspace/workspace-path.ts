import fs from 'node:fs/promises'
import path from 'node:path'
import { WorkspaceServiceError } from './workspace-errors'

const normalizeForCompare = (value: string) =>
  process.platform === 'win32' ? value.toLowerCase() : value

const isAbsoluteOrUncPath = (value: string) => {
  if (path.isAbsolute(value)) return true
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  if (/^(?:\\\\|\/\/)/.test(value)) return true
  return false
}

const isWithinRoot = (root: string, target: string) => {
  const normalizedRoot = normalizeForCompare(path.resolve(root))
  const normalizedTarget = normalizeForCompare(path.resolve(target))
  const relative = path.relative(normalizedRoot, normalizedTarget)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const toPortableRelativePath = (value: string) => value.split(path.sep).join('/')

const ensureRelativeInput = (rawInput: string) => {
  const value = (rawInput || '').trim()
  if (value.includes('\u0000')) {
    throw new WorkspaceServiceError('路径包含非法空字符', 400, 'WORKSPACE_INVALID_PATH')
  }
  if (isAbsoluteOrUncPath(value)) {
    throw new WorkspaceServiceError('禁止使用绝对路径', 400, 'WORKSPACE_INVALID_PATH')
  }
  return value
}

const resolveExistingParentRealPath = async (targetPath: string, rootPath: string) => {
  let current = path.resolve(targetPath)
  const root = path.resolve(rootPath)
  while (!isWithinRoot(root, current)) {
    throw new WorkspaceServiceError('路径越界访问被拒绝', 403, 'WORKSPACE_PATH_ESCAPE')
  }
  while (true) {
    try {
      return await fs.realpath(current)
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
      const parent = path.dirname(current)
      if (parent === current) {
        break
      }
      if (path.resolve(current) === root) {
        break
      }
      current = parent
    }
  }
  return fs.realpath(root).catch(() => root)
}

export interface ResolveWorkspacePathOptions {
  allowRoot?: boolean
  requireExists?: boolean
}

export const resolveWorkspacePath = async (
  workspaceRoot: string,
  requestedPath: string,
  options: ResolveWorkspacePathOptions = {},
): Promise<{ absolutePath: string; relativePath: string }> => {
  const root = path.resolve(workspaceRoot)
  const input = ensureRelativeInput(requestedPath)
  const rawRelative = input.length > 0 ? input : '.'
  const candidate = path.resolve(root, rawRelative)

  if (!isWithinRoot(root, candidate)) {
    throw new WorkspaceServiceError('路径越界访问被拒绝', 403, 'WORKSPACE_PATH_ESCAPE')
  }

  const rootRealPath = await fs.realpath(root).catch(() => root)
  let targetRealPath: string | null = null

  try {
    targetRealPath = await fs.realpath(candidate)
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
    if (options.requireExists) {
      throw new WorkspaceServiceError('目标路径不存在', 404, 'WORKSPACE_PATH_NOT_FOUND')
    }
  }

  const checkPath = targetRealPath
    ? targetRealPath
    : await resolveExistingParentRealPath(candidate, root)

  if (!isWithinRoot(rootRealPath, checkPath)) {
    throw new WorkspaceServiceError('路径越界访问被拒绝', 403, 'WORKSPACE_PATH_ESCAPE')
  }

  const relativePathRaw = path.relative(root, candidate)
  const relativePath = relativePathRaw.length > 0 ? toPortableRelativePath(relativePathRaw) : '.'
  if (!options.allowRoot && relativePath === '.') {
    throw new WorkspaceServiceError(
      '不允许直接操作 workspace 根目录',
      400,
      'WORKSPACE_INVALID_PATH',
    )
  }

  return {
    absolutePath: candidate,
    relativePath,
  }
}

export const ensureArtifactRelativePath = (relativePath: string) => {
  const normalized = toPortableRelativePath((relativePath || '').trim())
  if (!normalized || normalized === '.' || normalized === 'artifacts') {
    throw new WorkspaceServiceError('artifact 路径无效', 400, 'WORKSPACE_INVALID_ARTIFACT_PATH')
  }
  if (!normalized.startsWith('artifacts/')) {
    throw new WorkspaceServiceError(
      '仅允许发布 artifacts 目录下的文件',
      403,
      'WORKSPACE_INVALID_ARTIFACT_PATH',
    )
  }
  return normalized
}

export const safeFileNameFromRelativePath = (relativePath: string) => {
  const normalized = toPortableRelativePath(relativePath)
  const fileName = normalized.split('/').filter(Boolean).pop() || 'artifact'
  return fileName
}

export const ensureHttpsGitUrl = (raw: string) => {
  const value = (raw || '').trim()
  if (!value) {
    throw new WorkspaceServiceError('git 地址不能为空', 400, 'WORKSPACE_GIT_URL_REQUIRED')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new WorkspaceServiceError('git 地址格式无效', 400, 'WORKSPACE_GIT_URL_INVALID')
  }
  if (parsed.protocol !== 'https:') {
    throw new WorkspaceServiceError('仅允许 https git 地址', 400, 'WORKSPACE_GIT_URL_INVALID')
  }
  return value
}
