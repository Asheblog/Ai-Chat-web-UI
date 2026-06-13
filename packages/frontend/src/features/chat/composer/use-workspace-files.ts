/**
 * 工作区文件管理 Hook
 * 支持批量并发上传（最多 3 个）、上传状态跟踪、重试
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ToastHandler } from './types'

export type FileUploadState = 'uploading' | 'ready' | 'error'

export interface WorkspaceFile {
  localId: string
  filename: string
  originalName: string
  mimeType: string
  fileSize: number
  workspacePath: string
  status: FileUploadState
  errorMessage?: string
}

const MAX_CONCURRENCY = 3

interface UseWorkspaceFilesOptions {
  sessionId: number | null
  toast: ToastHandler
  onFilesChange?: (files: WorkspaceFile[]) => void
}

export const useWorkspaceFiles = ({
  sessionId,
  toast,
  onFilesChange,
}: UseWorkspaceFilesOptions) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<WorkspaceFile[]>([])

  // 存储原始 File 对象供重试用
  const fileStoreRef = useRef<Map<string, File>>(new Map())

  const isUploading = useMemo(
    () => files.some((f) => f.status === 'uploading'),
    [files],
  )

  useEffect(() => {
    setFiles([])
    fileStoreRef.current.clear()
    onFilesChange?.([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when session changes
  }, [sessionId])

  const pickFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const updateFiles = useCallback(
    (updater: (prev: WorkspaceFile[]) => WorkspaceFile[]) => {
      setFiles((prev) => {
        const next = updater(prev)
        onFilesChange?.(next)
        return next
      })
    },
    [onFilesChange],
  )

  const uploadFileToServer = useCallback(
    async (
      file: File,
    ): Promise<{
      filename: string
      originalName: string
      mimeType: string
      fileSize: number
      workspacePath: string
    } | null> => {
      if (!sessionId) return null

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/api/chat/sessions/${sessionId}/files`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
        throw new Error(errorBody.error || `上传失败（${response.status}）`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || '上传失败')
      }

      return {
        filename: result.data.filename,
        originalName: result.data.originalName,
        mimeType: result.data.mimeType,
        fileSize: result.data.fileSize,
        workspacePath: result.data.workspacePath,
      }
    },
    [sessionId],
  )

  /**
   * 批量上传文件，最多 MAX_CONCURRENCY 个并发
   */
  const uploadFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0 || !sessionId) return

      // 为每个文件分配 localId
      const entries = fileList.map((f) => ({
        localId: crypto.randomUUID(),
        file: f,
      }))

      // 存储 File 引用供重试
      for (const e of entries) {
        fileStoreRef.current.set(e.localId, e.file)
      }

      // 立即添加为 uploading 状态
      updateFiles((prev) => [
        ...prev,
        ...entries.map((e) => ({
          localId: e.localId,
          filename: '',
          originalName: e.file.name,
          mimeType: e.file.type || 'application/octet-stream',
          fileSize: e.file.size,
          workspacePath: '',
          status: 'uploading' as FileUploadState,
        })),
      ])

      // 工作线程池，最多 MAX_CONCURRENCY 个并发
      const results: Array<'success' | 'failure'> = new Array(fileList.length)
      let idx = 0
      const workers = Array.from(
        { length: Math.min(MAX_CONCURRENCY, fileList.length) },
        async () => {
          while (idx < fileList.length) {
            const i = idx++
            const entry = entries[i]
            try {
              const uploaded = await uploadFileToServer(entry.file)
              if (uploaded) {
                updateFiles((prev) =>
                  prev.map((f) =>
                    f.localId === entry.localId
                      ? {
                          localId: f.localId,
                          filename: uploaded.filename,
                          originalName: uploaded.originalName,
                          mimeType: uploaded.mimeType,
                          fileSize: uploaded.fileSize,
                          workspacePath: uploaded.workspacePath,
                          status: 'ready' as FileUploadState,
                        }
                      : f,
                  ),
                )
                fileStoreRef.current.delete(entry.localId)
                results[i] = 'success'
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : '上传失败'
              updateFiles((prev) =>
                prev.map((f) =>
                  f.localId === entry.localId
                    ? {
                        ...f,
                        status: 'error' as FileUploadState,
                        errorMessage: message,
                      }
                    : f,
                ),
              )
              toast({
                title: '上传失败',
                description: `${entry.file.name}: ${message}`,
                variant: 'destructive',
              })
              results[i] = 'failure'
            }
          }
        },
      )

      await Promise.all(workers)

      // 结果聚合提示
      const successCount = results.filter((r) => r === 'success').length
      const failureCount = results.filter((r) => r === 'failure').length
      if (successCount === 0 && failureCount > 0) {
        toast({
          title: '所有文件上传失败',
          description: '可在附件管理中重试或移除',
          variant: 'destructive',
        })
      } else if (successCount > 0 && failureCount > 0) {
        toast({
          title: `${successCount} 个文件上传成功`,
          description: `${failureCount} 个文件上传失败，可在附件管理中重试`,
        })
      }
    },
    [sessionId, uploadFileToServer, updateFiles, toast],
  )

  /**
   * 重试上传失败的文件
   */
  const retryUpload = useCallback(
    async (localId: string) => {
      const existing = files.find((f) => f.localId === localId)
      if (!existing || !sessionId) return

      // 查找原始 File（可能因上传完成已被清理，但 error 文件不会被清理）
      const originalFile = fileStoreRef.current.get(localId)
      if (!originalFile) {
        toast({
          title: '重试失败',
          description: '无法获取原始文件',
          variant: 'destructive',
        })
        return
      }

      // 重置为 uploading
      updateFiles((prev) =>
        prev.map((f) =>
          f.localId === localId
            ? { ...f, status: 'uploading' as FileUploadState, errorMessage: undefined }
            : f,
        ),
      )

      try {
        const uploaded = await uploadFileToServer(originalFile)
        if (uploaded) {
          updateFiles((prev) =>
            prev.map((f) =>
              f.localId === localId
                ? {
                    localId: f.localId,
                    filename: uploaded.filename,
                    originalName: uploaded.originalName,
                    mimeType: uploaded.mimeType,
                    fileSize: uploaded.fileSize,
                    workspacePath: uploaded.workspacePath,
                    status: 'ready' as FileUploadState,
                  }
                : f,
            ),
          )
          fileStoreRef.current.delete(localId)
          toast({
            title: '上传成功',
            description: `${existing.originalName} 已重新上传`,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '重试失败'
        updateFiles((prev) =>
          prev.map((f) =>
            f.localId === localId
              ? { ...f, status: 'error' as FileUploadState, errorMessage: message }
              : f,
          ),
        )
        toast({
          title: '重试失败',
          description: `${existing.originalName}: ${message}`,
          variant: 'destructive',
        })
      }
    },
    [files, sessionId, uploadFileToServer, updateFiles, toast],
  )

  const onFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files || [])
      if (selectedFiles.length === 0) return

      await uploadFiles(selectedFiles)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [uploadFiles],
  )

  /**
   * 移除文件（支持 workspacePath 或 localId）
   */
  const removeFile = useCallback(
    async (identifier: string) => {
      const target = files.find(
        (f) => f.workspacePath === identifier || f.localId === identifier,
      )
      if (!target) return

      // 已上传到服务器的文件同时请求删除
      if (target.workspacePath && sessionId) {
        await fetch(
          `/api/chat/sessions/${sessionId}/files?path=${encodeURIComponent(target.workspacePath)}`,
          { method: 'DELETE', credentials: 'include' },
        ).catch(() => {})
      }

      fileStoreRef.current.delete(target.localId)

      updateFiles((prev) => prev.filter((f) => f.localId !== target.localId))
    },
    [files, sessionId, updateFiles],
  )

  const clearFiles = useCallback(() => {
    fileStoreRef.current.clear()
    updateFiles(() => [])
  }, [updateFiles])

  return {
    fileInputRef,
    files,
    isUploading,
    hasFiles: files.length > 0,
    pickFiles,
    uploadFiles,
    retryUpload,
    onFilesSelected,
    removeFile,
    clearFiles,
  }
}
