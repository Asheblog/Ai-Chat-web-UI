/**
 * 文档附件 Hook
 * 用于管理文档上传和状态
 */

import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ToastHandler } from './types'

export interface AttachedDocument {
  id: number
  filename: string
  originalName: string
  mimeType: string
  fileSize: number
  status: 'uploading' | 'pending' | 'processing' | 'ready' | 'error'
  progress?: number
  errorMessage?: string
}

export interface DocumentLimits {
  maxFileSize: number // 字节
  allowedTypes: string[]
}

interface UseDocumentAttachmentsOptions {
  sessionId: number | null
  limits: DocumentLimits
  toast: ToastHandler
  onDocumentsChange?: (documents: AttachedDocument[]) => void
}

const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/csv',
  'application/csv',
  'text/plain',
  'text/markdown',
]

const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.csv', '.txt', '.md']

export const useDocumentAttachments = ({
  sessionId,
  limits,
  toast,
  onDocumentsChange,
}: UseDocumentAttachmentsOptions) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<AttachedDocument[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const updateDocuments = useCallback(
    (updater: (prev: AttachedDocument[]) => AttachedDocument[]) => {
      setDocuments((prev) => {
        const next = updater(prev)
        onDocumentsChange?.(next)
        return next
      })
    },
    [onDocumentsChange]
  )

  const isSupportedFile = useCallback((file: File): boolean => {
    // 检查 MIME 类型
    if (SUPPORTED_MIME_TYPES.includes(file.type)) {
      return true
    }

    // 检查扩展名（某些浏览器可能不返回正确的 MIME 类型）
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    return SUPPORTED_EXTENSIONS.includes(ext)
  }, [])

  const pickDocuments = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const uploadDocument = useCallback(
    async (file: File): Promise<AttachedDocument | null> => {
      const formData = new FormData()
      formData.append('file', file)
      if (sessionId) {
        formData.append('sessionId', sessionId.toString())
      }

      try {
        const response = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        })

        const result = await response.json()

        if (!result.success) {
          throw new Error(result.error || '上传失败')
        }

        return {
          id: result.data.documentId,
          filename: result.data.filename,
          originalName: file.name,
          mimeType: file.type,
          fileSize: file.size,
          status: result.data.status,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '上传失败'
        throw new Error(message)
      }
    },
    [sessionId]
  )

  const onFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || [])
      if (files.length === 0) return

      // 验证文件
      const validFiles: File[] = []
      for (const file of files) {
        if (!isSupportedFile(file)) {
          toast({
            title: '不支持的文件类型',
            description: `${file.name} 不是支持的文档格式`,
            variant: 'destructive',
          })
          continue
        }

        if (file.size > limits.maxFileSize) {
          toast({
            title: '文件过大',
            description: `${file.name} 超过 ${Math.round(limits.maxFileSize / 1024 / 1024)}MB 限制`,
            variant: 'destructive',
          })
          continue
        }

        validFiles.push(file)
      }

      if (validFiles.length === 0) {
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        return
      }

      setIsUploading(true)

      // 上传文件
      for (const file of validFiles) {
        // 添加临时状态
        const tempId = Date.now()
        updateDocuments((prev) => [
          ...prev,
          {
            id: tempId,
            filename: '',
            originalName: file.name,
            mimeType: file.type,
            fileSize: file.size,
            status: 'uploading' as const,
            progress: 0,
          },
        ])

        try {
          const doc = await uploadDocument(file)
          if (doc) {
            // 更新为真实文档
            updateDocuments((prev) =>
              prev.map((d) =>
                d.id === tempId
                  ? { ...doc, status: 'processing' as const }
                  : d
              )
            )

            // 开始轮询状态
            pollDocumentStatus(doc.id)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '上传失败'
          updateDocuments((prev) =>
            prev.map((d) =>
              d.id === tempId
                ? { ...d, status: 'error' as const, errorMessage: message }
                : d
            )
          )
          toast({
            title: '上传失败',
            description: message,
            variant: 'destructive',
          })
        }
      }

      setIsUploading(false)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [isSupportedFile, limits.maxFileSize, toast, updateDocuments, uploadDocument]
  )

  const pollDocumentStatus = useCallback(
    async (documentId: number) => {
      const maxRetries = 60 // 最多轮询 60 次（约 2 分钟）
      let retries = 0

      const poll = async () => {
        try {
          const response = await fetch(`/api/documents/${documentId}`, {
            credentials: 'include',
          })
          const result = await response.json()

          if (result.success) {
            const status = result.data.status as AttachedDocument['status']

            updateDocuments((prev) =>
              prev.map((d) =>
                d.id === documentId
                  ? { ...d, status, errorMessage: result.data.errorMessage }
                  : d
              )
            )

            if (status === 'pending' || status === 'processing') {
              if (retries < maxRetries) {
                retries++
                setTimeout(poll, 2000)
              }
            }
          }
        } catch {
          // 忽略轮询错误
        }
      }

      // 开始轮询
      setTimeout(poll, 2000)
    },
    [updateDocuments]
  )

  const removeDocument = useCallback(
    async (documentId: number) => {
      // 先从列表移除
      updateDocuments((prev) => prev.filter((d) => d.id !== documentId))

      // 调用 API 删除
      try {
        await fetch(`/api/documents/${documentId}`, {
          method: 'DELETE',
          credentials: 'include',
        })
      } catch {
        // 忽略删除错误
      }
    },
    [updateDocuments]
  )

  const clearDocuments = useCallback(() => {
    updateDocuments(() => [])
  }, [updateDocuments])

  const hasReadyDocuments = documents.some((d) => d.status === 'ready')
  const hasProcessingDocuments = documents.some(
    (d) => d.status === 'uploading' || d.status === 'processing' || d.status === 'pending'
  )

  return {
    fileInputRef,
    documents,
    isUploading,
    hasReadyDocuments,
    hasProcessingDocuments,
    pickDocuments,
    onFilesSelected,
    removeDocument,
    clearDocuments,
  }
}
