/**
 * 文档附件 Hook
 * 用于管理文档上传和状态
 */

import { useCallback, useEffect, useRef, useState } from 'react'
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
  processingStage?: string
  processingProgress?: number
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
  /**
   * 草稿存储 Key（用于 sessionId 为空时在页面刷新后恢复附件）
   * 仅在 sessionId === null 时生效，存储介质为 sessionStorage。
   */
  draftKey?: string
}

/**
 * 支持的 MIME 类型（必须与后端 loaders 保持一致）
 * - PDF: pdf-loader.ts
 * - DOCX: docx-loader.ts
 * - CSV: csv-loader.ts
 * - Text/Code: text-loader.ts
 */
const SUPPORTED_MIME_TYPES = [
  // PDF
  'application/pdf',
  // DOCX
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // CSV
  'text/csv',
  'application/csv',
  // 文本和代码文件
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'text/x-python',
  'text/x-java',
  'text/css',
  'text/html',
  'text/xml',
  'application/xml',
]

/**
 * 支持的文件扩展名（用于浏览器未正确识别 MIME 类型时的回退检测）
 */
const SUPPORTED_EXTENSIONS = [
  // 文档
  '.pdf',
  '.docx',
  '.csv',
  // 文本
  '.txt',
  '.md',
  '.markdown',
  // 代码文件
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.py',
  '.java',
  '.css',
  '.html',
  '.htm',
  '.xml',
]

/**
 * HTML input accept 属性值
 */
export const DOCUMENT_ACCEPT_TYPES = SUPPORTED_EXTENSIONS.join(',')

export const useDocumentAttachments = ({
  sessionId,
  limits,
  toast,
  onDocumentsChange,
  draftKey,
}: UseDocumentAttachmentsOptions) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<AttachedDocument[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const draftEnabled = sessionId === null && typeof draftKey === 'string' && draftKey.trim().length > 0

  const readDraftDocuments = useCallback((): AttachedDocument[] => {
    if (!draftEnabled || typeof window === 'undefined') return []
    try {
      const raw = sessionStorage.getItem(draftKey!)
      if (!raw) return []
      const parsed = JSON.parse(raw) as any
      const payload = Array.isArray(parsed) ? parsed : parsed?.documents
      if (!Array.isArray(payload)) return []
      return payload
        .filter((item: any) => item && typeof item.id === 'number' && typeof item.originalName === 'string')
        .map((item: any) => ({
          id: item.id,
          filename: typeof item.filename === 'string' ? item.filename : '',
          originalName: item.originalName,
          mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'application/octet-stream',
          fileSize: typeof item.fileSize === 'number' ? item.fileSize : 0,
          status: (item.status || 'processing') as AttachedDocument['status'],
          processingStage: typeof item.processingStage === 'string' ? item.processingStage : undefined,
          processingProgress: typeof item.processingProgress === 'number' ? item.processingProgress : undefined,
          errorMessage: typeof item.errorMessage === 'string' ? item.errorMessage : undefined,
        }))
    } catch {
      return []
    }
  }, [draftEnabled, draftKey])

  const writeDraftDocuments = useCallback(
    (nextDocuments: AttachedDocument[]) => {
      if (!draftEnabled || typeof window === 'undefined') return
      const payload = nextDocuments
        .filter((d) => d.status !== 'uploading')
        .map((d) => ({
          id: d.id,
          filename: d.filename,
          originalName: d.originalName,
          mimeType: d.mimeType,
          fileSize: d.fileSize,
          status: d.status,
          processingStage: d.processingStage,
          processingProgress: d.processingProgress,
          errorMessage: d.errorMessage,
        }))

      try {
        if (payload.length === 0) {
          sessionStorage.removeItem(draftKey!)
          return
        }
        sessionStorage.setItem(draftKey!, JSON.stringify({ version: 1, documents: payload }))
      } catch {
        // ignore storage error
      }
    },
    [draftEnabled, draftKey],
  )

  // 当 sessionId 变化时，从后端加载已关联的文档
  useEffect(() => {
    if (sessionId === null) {
      if (!draftEnabled) {
        setDocuments([])
        onDocumentsChange?.([])
        return
      }

      const restored = readDraftDocuments()
      setDocuments(restored)
      onDocumentsChange?.(restored)
      restored.forEach((d) => {
        if (d.status === 'pending' || d.status === 'processing') {
          pollDocumentStatus(d.id)
        }
      })
      return
    }

    let cancelled = false
    const loadSessionDocuments = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/documents/session/${sessionId}`, {
          credentials: 'include',
        })
        const result = await response.json()

        if (!cancelled && result.success && Array.isArray(result.data)) {
          const loadedDocs: AttachedDocument[] = result.data.map((doc: any) => ({
            id: doc.id,
            filename: doc.filename,
            originalName: doc.originalName,
            mimeType: doc.mimeType,
            fileSize: doc.fileSize,
            status: doc.status as AttachedDocument['status'],
            processingStage: doc.processingStage,
            processingProgress: doc.processingProgress,
            errorMessage: doc.errorMessage,
          }))
          setDocuments(loadedDocs)
          onDocumentsChange?.(loadedDocs)

          // 对未完成的文档持续轮询，确保刷新页面后仍能更新状态
          loadedDocs.forEach((d) => {
            if (d.status === 'pending' || d.status === 'processing') {
              pollDocumentStatus(d.id)
            }
          })
        }
      } catch (error) {
        // 静默处理加载错误（可能是 RAG 未启用）
        console.warn('[Documents] Failed to load session documents:', error)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadSessionDocuments()

    return () => {
      cancelled = true
    }
  }, [draftEnabled, onDocumentsChange, readDraftDocuments, sessionId])

  useEffect(() => {
    writeDraftDocuments(documents)
  }, [documents, writeDraftDocuments])

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
          const ext = '.' + file.name.split('.').pop()?.toLowerCase()
          let hint: string
          if (ext === '.doc') {
            hint = `${file.name} 为旧版 .doc 格式，请先转为 .docx 再上传`
          } else if (ext === '.xls' || ext === '.xlsx') {
            hint = `${file.name} 为 Excel 格式，暂不支持，请导出为 CSV 后上传`
          } else if (ext === '.ppt' || ext === '.pptx') {
            hint = `${file.name} 为 PPT 格式，暂不支持`
          } else {
            hint = `${file.name} 不是支持的文件格式。支持: PDF、DOCX、CSV、TXT、MD、代码文件(JSON/JS/TS/PY/JAVA/CSS/HTML/XML)`
          }
          toast({
            title: '不支持的文件类型',
            description: hint,
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
                  ? {
                      ...d,
                      status,
                      processingStage: result.data.processingStage,
                      processingProgress: result.data.processingProgress,
                      errorMessage: result.data.errorMessage,
                    }
                  : d
              )
            )

            if (status === 'pending' || status === 'processing') {
              setTimeout(poll, 2000)
            }
          }
        } catch {
          // 忽略轮询错误
          setTimeout(poll, 4000)
        }
      }

      // 开始轮询
      setTimeout(poll, 2000)
    },
    [updateDocuments]
  )

  const cancelDocument = useCallback(
    async (documentId: number) => {
      try {
        await fetch(`/api/documents/${documentId}/cancel`, {
          method: 'POST',
          credentials: 'include',
        })
        // 取消后会被后端标记为 error
        pollDocumentStatus(documentId)
      } catch {
        // 忽略取消错误
      }
    },
    [pollDocumentStatus]
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
    if (draftEnabled && typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(draftKey!)
      } catch {
        // ignore storage error
      }
    }
  }, [draftEnabled, draftKey, updateDocuments])

  const hasReadyDocuments = documents.some((d) => d.status === 'ready')
  const hasProcessingDocuments = documents.some(
    (d) => d.status === 'uploading' || d.status === 'processing' || d.status === 'pending'
  )

  return {
    fileInputRef,
    documents,
    isUploading,
    isLoading,
    hasReadyDocuments,
    hasProcessingDocuments,
    pickDocuments,
    onFilesSelected,
    removeDocument,
    cancelDocument,
    clearDocuments,
  }
}
