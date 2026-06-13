import { describe, it, expect } from 'vitest'
import { toWorkspaceSandboxPath, buildWorkspaceFileManifest } from '../workspace-file-manifest'

describe('toWorkspaceSandboxPath', () => {
  it('normalises backslashes to forward slashes', () => {
    expect(toWorkspaceSandboxPath('input\\report.xlsx')).toBe('/workspace/input/report.xlsx')
  })

  it('prepends /workspace/ to a relative path', () => {
    expect(toWorkspaceSandboxPath('input/report.xlsx')).toBe('/workspace/input/report.xlsx')
  })

  it('prepends /workspace to an absolute path', () => {
    expect(toWorkspaceSandboxPath('/input/report.xlsx')).toBe('/workspace/input/report.xlsx')
  })

  it('does not double-prefix an already correct workspace path', () => {
    expect(toWorkspaceSandboxPath('/workspace/input/report.xlsx')).toBe('/workspace/input/report.xlsx')
  })
})

describe('buildWorkspaceFileManifest', () => {
  it('returns empty string for empty array', () => {
    expect(buildWorkspaceFileManifest([])).toBe('')
  })

  it('builds manifest with one file', () => {
    const result = buildWorkspaceFileManifest([
      { originalName: '报表.xlsx', workspacePath: 'input/srv.xlsx' },
    ])
    expect(result).toContain('已上传工作区文件（可使用 Python 读取）')
    expect(result).toContain('报表.xlsx')
    expect(result).toContain('/workspace/input/srv.xlsx')
    expect(result).toContain('Python')
  })

  it('builds manifest with multiple files', () => {
    const result = buildWorkspaceFileManifest([
      { originalName: 'a.pdf', workspacePath: 'input/a.pdf' },
      { originalName: 'b.csv', workspacePath: 'input/b.csv' },
    ])
    expect(result).toContain('a.pdf')
    expect(result).toContain('/workspace/input/a.pdf')
    expect(result).toContain('b.csv')
    expect(result).toContain('/workspace/input/b.csv')
    expect(result).toContain('\n')
  })

  it('normalises Windows paths in manifest', () => {
    const result = buildWorkspaceFileManifest([
      { originalName: 'report.xlsx', workspacePath: 'input\\report.xlsx' },
    ])
    expect(result).toContain('/workspace/input/report.xlsx')
    expect(result).not.toContain('\\')
  })
})
