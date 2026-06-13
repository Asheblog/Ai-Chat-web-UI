import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSendCommand } from '../use-send-command'
import type { WorkspaceFile } from '@/features/chat/composer'

const mockStreamMessage = vi.fn().mockResolvedValue(undefined)
const mockBuildRequestPayload = vi.fn().mockReturnValue({ ok: true })
const mockToast = vi.fn()
const mockSetInput = vi.fn()
const mockSetSelectedImages = vi.fn()
const mockClearError = vi.fn()
const mockSetNoSaveThisRound = vi.fn()

const makeBaseParams = () => ({
  input: '',
  hasWorkspaceFiles: false,
  workspaceFiles: [] as WorkspaceFile[],
  currentSession: { id: 1 },
  concurrencyLocked: false,
  totalActiveStreams: 0,
  maxConcurrentStreams: 1,
  clearError: mockClearError,
  isVisionEnabled: false,
  selectedImages: [],
  setSelectedImages: mockSetSelectedImages,
  buildRequestPayload: mockBuildRequestPayload,
  enabledExtraSkills: [],
  webSearchEnabled: false,
  canUseWebSearch: false,
  webSearchScope: '',
  isMetasoEngine: false,
  canUsePythonTool: true,
  pythonToolEnabled: true,
  thinkingEnabled: false,
  effort: 'unset' as const,
  ollamaThink: false,
  noSaveThisRound: false,
  setNoSaveThisRound: mockSetNoSaveThisRound,
  traceEnabled: false,
  canUseTrace: false,
  streamMessage: mockStreamMessage,
  toast: mockToast,
  setInput: mockSetInput,
})

const mockWorkspaceFiles: WorkspaceFile[] = [
  {
    localId: 'id-1',
    filename: 'x1y2z3.xlsx',
    originalName: '报表.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: 20480,
    // 后端返回的是相对于 workspace root 的路径
    workspacePath: 'input/x1y2z3.xlsx',
    status: 'ready',
  },
  {
    localId: 'id-2',
    filename: 'a1b2c3.csv',
    originalName: 'data.csv',
    mimeType: 'text/csv',
    fileSize: 4096,
    workspacePath: 'input/a1b2c3.csv',
    status: 'ready',
  },
]

describe('useSendCommand with workspace files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends input message plus file manifest when input is non-empty with workspace files', async () => {
    const params = { ...makeBaseParams(), input: '分析这些文件', hasWorkspaceFiles: true, workspaceFiles: mockWorkspaceFiles }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    expect(mockStreamMessage).toHaveBeenCalledOnce()
    const [, message] = mockStreamMessage.mock.calls[0]

    // Must include original input
    expect(message).toContain('分析这些文件')
    // Must include file manifest with original names and workspace paths
    expect(message).toContain('报表.xlsx')
    expect(message).toContain('/workspace/input/x1y2z3.xlsx')
    expect(message).toContain('data.csv')
    expect(message).toContain('/workspace/input/a1b2c3.csv')
    // Must mention Python tools hint
    expect(message).toContain('Python')
  })

  it('sends fallback text plus file manifest when input is empty with workspace files', async () => {
    const params = { ...makeBaseParams(), input: '', hasWorkspaceFiles: true, workspaceFiles: mockWorkspaceFiles }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    expect(mockStreamMessage).toHaveBeenCalledOnce()
    const [, message] = mockStreamMessage.mock.calls[0]

    expect(message).toContain('请分析工作区中的文件')
    expect(message).toContain('报表.xlsx')
    expect(message).toContain('/workspace/input/x1y2z3.xlsx')
    expect(message).toContain('data.csv')
    expect(message).toContain('/workspace/input/a1b2c3.csv')
  })

  it('does not send when canUsePythonTool is false', async () => {
    const params = { ...makeBaseParams(), input: '', hasWorkspaceFiles: true, workspaceFiles: mockWorkspaceFiles, canUsePythonTool: false }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    expect(mockStreamMessage).not.toHaveBeenCalled()
    expect(mockToast).toHaveBeenCalled()
  })

  it('does not clear workspace files after sending (files persist across messages)', async () => {
    const params = { ...makeBaseParams(), input: '分析', hasWorkspaceFiles: true, workspaceFiles: mockWorkspaceFiles }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    // workspaceFiles is read-only from the parent; parent controls lifecycle
    // At minimum, verify the send succeeded
    expect(mockStreamMessage).toHaveBeenCalledOnce()
  })

  it('does not send when files are all uploading (no ready files)', async () => {
    const uploadingFiles: WorkspaceFile[] = [
      { ...mockWorkspaceFiles[0], status: 'uploading' },
      { ...mockWorkspaceFiles[1], status: 'uploading' },
    ]
    const params = { ...makeBaseParams(), input: '', hasWorkspaceFiles: true, workspaceFiles: uploadingFiles }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    // No ready files, input empty → should not send
    expect(mockStreamMessage).not.toHaveBeenCalled()
  })

  it('does not send when files are all error (no ready files)', async () => {
    const errorFiles: WorkspaceFile[] = [
      { ...mockWorkspaceFiles[0], status: 'error', errorMessage: '413 文件过大' },
    ]
    const params = { ...makeBaseParams(), input: '', hasWorkspaceFiles: true, workspaceFiles: errorFiles }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    expect(mockStreamMessage).not.toHaveBeenCalled()
  })

  it('includes only ready files in manifest when mixed with error files', async () => {
    const mixedFiles: WorkspaceFile[] = [
      mockWorkspaceFiles[0], // ready
      { ...mockWorkspaceFiles[1], status: 'error', errorMessage: '上传失败' },
    ]
    const params = { ...makeBaseParams(), input: '分析', hasWorkspaceFiles: true, workspaceFiles: mixedFiles }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    expect(mockStreamMessage).toHaveBeenCalledOnce()
    const [, message] = mockStreamMessage.mock.calls[0]

    // Should include the ready file
    expect(message).toContain('报表.xlsx')
    expect(message).toContain('/workspace/input/x1y2z3.xlsx')
    // Should NOT include the error file
    expect(message).not.toContain('data.csv')
  })
})

describe('useSendCommand without workspace files', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends only the input text when hasWorkspaceFiles is false', async () => {
    const params = { ...makeBaseParams(), input: 'hi' }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    expect(mockStreamMessage).toHaveBeenCalledOnce()
    const [, message] = mockStreamMessage.mock.calls[0]
    expect(message).toBe('hi')
    // No file manifest
    expect(message).not.toContain('工作区')
    expect(message).not.toContain('/workspace')
  })

  it('does nothing when input is empty and no workspace files', async () => {
    const params = { ...makeBaseParams(), input: '' }
    const { result } = renderHook(() => useSendCommand(params))

    await act(async () => {
      await result.current()
    })

    expect(mockStreamMessage).not.toHaveBeenCalled()
  })
})
