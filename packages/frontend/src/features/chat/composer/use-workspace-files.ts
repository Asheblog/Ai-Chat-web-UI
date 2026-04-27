/**
 * 工作区文件管理 Hook
 * 替代 use-document-attachments，直接上传文件到 workspace input 目录
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ToastHandler } from './types'

export interface WorkspaceFile {
  filename: string
  originalName: string
  mimeType: string
  fileSize: number
  workspacePath: string
}

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
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    setFiles([])
    onFilesChange?.([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when session changes
  }, [sessionId])

  const pickFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const uploadFile = useCallback(
    async (file: File): Promise<WorkspaceFile | null> => {
      if (!sessionId) return null

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/api/chat/sessions/${sessionId}/files`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })

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

  const onFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files || [])
      if (selectedFiles.length === 0) return

      setIsUploading(true)

      for (const file of selectedFiles) {
        const tempName = file.name
        try {
          const uploaded = await uploadFile(file)
          if (uploaded) {
            setFiles((prev) => {
              const next = [...prev, uploaded]
              onFilesChange?.(next)
              return next
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '上传失败'
          toast({
            title: '上传失败',
            description: `${tempName}: ${message}`,
            variant: 'destructive',
          })
        }
      }

      setIsUploading(false)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [uploadFile, onFilesChange, toast],
  )

  const removeFile = useCallback(
    async (workspacePath: string) => {
      if (sessionId) {
        await fetch(
          `/api/chat/sessions/${sessionId}/files?path=${encodeURIComponent(workspacePath)}`,
          { method: 'DELETE', credentials: 'include' },
        ).catch(() => {})
      }
      setFiles((prev) => {
        const next = prev.filter((f) => f.workspacePath !== workspacePath)
        onFilesChange?.(next)
        return next
      })
    },
    [sessionId, onFilesChange],
  )

  const clearFiles = useCallback(() => {
    setFiles([])
    onFilesChange?.([])
  }, [onFilesChange])

  return {
    fileInputRef,
    files,
    isUploading,
    hasFiles: files.length > 0,
    pickFiles,
    onFilesSelected,
    removeFile,
    clearFiles,
  }
}
