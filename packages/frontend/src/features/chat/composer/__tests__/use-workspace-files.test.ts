import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useWorkspaceFiles } from '../use-workspace-files'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mockFile = (name: string, size = 1024, type = 'application/pdf') => {
  return new File([new ArrayBuffer(size)], name, { type })
}

const mockUploadResponse = (overrides = {}) => ({
  success: true,
  data: {
    filename: 'server-uuid.pdf',
    originalName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSize: 1024,
    workspacePath: 'input/server-uuid.pdf',
    ...overrides,
  },
})

describe('useWorkspaceFiles - upload states', () => {
  let toast: ReturnType<typeof vi.fn>

  beforeEach(() => {
    toast = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // RED 1: files start as uploading, become ready on success
  it('adds files as uploading, then transitions to ready on success', async () => {
    const response = mockUploadResponse({
      originalName: 'report.pdf',
      workspacePath: 'input/report-uuid.pdf',
    })
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    } as Response)

    const { result } = renderHook(() =>
      useWorkspaceFiles({ sessionId: 1, toast }),
    )

    // Before upload, no files
    expect(result.current.files).toHaveLength(0)

    await act(async () => {
      await result.current.uploadFiles([mockFile('report.pdf')])
    })

    // After successful upload
    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].status).toBe('ready')
    expect(result.current.files[0].originalName).toBe('report.pdf')
    expect(result.current.files[0].workspacePath).toBe('input/report-uuid.pdf')
    expect(result.current.isUploading).toBe(false)
  })

  // RED 2: failed upload → error status
  it('transitions to error status on upload failure', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('413 文件过大'))

    const { result } = renderHook(() =>
      useWorkspaceFiles({ sessionId: 1, toast }),
    )

    await act(async () => {
      await result.current.uploadFiles([mockFile('huge.pdf')])
    })

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].status).toBe('error')
    expect(result.current.files[0].originalName).toBe('huge.pdf')
    expect(result.current.isUploading).toBe(false)
    expect(toast).toHaveBeenCalled()
  })

  // RED 3: retry re-uploads error file
  it('retry re-uploads an error file and transitions to ready', async () => {
    // First attempt fails
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('网络错误'))
    // Second attempt succeeds
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockUploadResponse({ originalName: 'retry.pdf', workspacePath: 'input/retry.pdf' }),
    } as Response)

    const { result } = renderHook(() =>
      useWorkspaceFiles({ sessionId: 1, toast }),
    )

    await act(async () => {
      await result.current.uploadFiles([mockFile('retry.pdf')])
    })

    expect(result.current.files[0].status).toBe('error')

    // Retry
    const errorFile = result.current.files[0]
    await act(async () => {
      await result.current.retryUpload(errorFile.localId)
    })

    expect(result.current.files).toHaveLength(1)
    expect(result.current.files[0].status).toBe('ready')
    expect(result.current.files[0].workspacePath).toBe('input/retry.pdf')
  })

  // RED 4: max 3 concurrent uploads
  it('uploads at most 3 files concurrently', async () => {
    const deferreds = Array.from({ length: 5 }, () => createDeferred<Response>())
    const refs = [...deferreds] // keep references before shift mutates

    vi.mocked(globalThis.fetch).mockImplementation(async () => {
      const d = deferreds.shift()!
      return d.promise
    })

    const { result } = renderHook(() =>
      useWorkspaceFiles({ sessionId: 1, toast }),
    )

    const files = [
      mockFile('a.pdf'), mockFile('b.pdf'), mockFile('c.pdf'),
      mockFile('d.pdf'), mockFile('e.pdf'),
    ]

    await act(async () => {
      result.current.uploadFiles(files)
    })

    // Wait for all 5 files to be in uploading state
    await waitFor(() => {
      expect(result.current.files.length).toBe(5)
      expect(result.current.files.every((f) => f.status === 'uploading')).toBe(true)
    })

    // At most 3 fetches should have been called at this point
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(3)

    // Resolve first 3 inside act — these trigger state updates in the hook
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        refs[i].resolve({
          ok: true,
          json: async () => mockUploadResponse({ originalName: `${String.fromCharCode(97 + i)}.pdf`, workspacePath: `input/${String.fromCharCode(97 + i)}.pdf` }),
        } as Response)
      }
    })

    // After resolving 3, the remaining 2 should be picked up by workers
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(5)
    })

    // Resolve last 2 inside act
    await act(async () => {
      for (let i = 3; i < 5; i++) {
        refs[i].resolve({
          ok: true,
          json: async () => mockUploadResponse({ originalName: `${String.fromCharCode(97 + i)}.pdf`, workspacePath: `input/${String.fromCharCode(97 + i)}.pdf` }),
        } as Response)
      }
    })

    // Wait for all files to be ready
    await waitFor(() => {
      expect(result.current.files.every((f) => f.status === 'ready')).toBe(true)
      expect(result.current.files).toHaveLength(5)
    })
  })

  // RED 5: uploading state during upload
  it('sets isUploading to true while uploading', async () => {
    let resolveUpload!: (value: unknown) => void
    const uploadPromise = new Promise((resolve) => {
      resolveUpload = resolve
    })

    vi.mocked(globalThis.fetch).mockReturnValueOnce(uploadPromise as Promise<Response>)

    const { result } = renderHook(() =>
      useWorkspaceFiles({ sessionId: 1, toast }),
    )

    // Start upload (will hang)
    let uploadDone = false
    act(() => {
      result.current.uploadFiles([mockFile('slow.pdf')]).then(() => {
        uploadDone = true
      })
    })

    // Should be uploading
    await waitFor(() => {
      expect(result.current.isUploading).toBe(true)
    })

    // Complete the upload — resolve in act so state updates are contained
    await act(async () => {
      resolveUpload({
        ok: true,
        json: async () => mockUploadResponse({ originalName: 'slow.pdf', workspacePath: 'input/slow.pdf' }),
      } as Response)
    })

    // Wait for upload to finish completely
    await waitFor(() => expect(uploadDone).toBe(true))
    await waitFor(() => {
      expect(result.current.isUploading).toBe(false)
      expect(result.current.files[0].status).toBe('ready')
    })
  })
})
