"use client"

import { useCallback, useState } from "react"
import type { ChangeEvent } from "react"
import { useToast } from "@/components/ui/use-toast"
import type { ApiResponse } from "@/types"
import { apiHttpClient } from "@/lib/api"
import type { UploadingFile } from "../knowledge-base-detail-dialog"

/** 服务端单次批量上传的文件数上限（与 api/knowledge-bases.ts 的校验一致）。 */
export const MAX_FILES_PER_BATCH = 20

/** 上传超时：基础 30 秒 + 每 10MB 追加 30 秒。 */
const calculateTimeout = (totalSize: number) =>
  30000 + Math.ceil(totalSize / (10 * 1024 * 1024)) * 30000

export interface UseKnowledgeBaseUploadOptions {
  knowledgeBaseId: number | null
  /** 服务端生效的单文件上限（ragMaxFileSizeMb 的已保存值） */
  maxFileSizeMb: number
  onUploaded: () => Promise<void> | void
}

/**
 * 知识库文档上传：单文件上限读设置项，不在前端另写一套常量。
 * 上传中保留逐文件状态与总进度，失败时给服务端文案。
 */
export function useKnowledgeBaseUpload({
  knowledgeBaseId,
  maxFileSizeMb,
  onUploaded,
}: UseKnowledgeBaseUploadOptions) {
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])

  const reset = useCallback(() => {
    setUploading(false)
    setUploadProgress(0)
    setUploadingFiles([])
  }, [])

  const upload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!knowledgeBaseId || !event.target.files?.length) return
      const files = Array.from(event.target.files)
      const maxBytes = maxFileSizeMb * 1024 * 1024

      const oversized = files.filter((file) => file.size > maxBytes)
      if (oversized.length > 0) {
        toast({
          title: "部分文件超过大小上限",
          description: `${oversized.map((file) => file.name).join("、")} 超过 ${maxFileSizeMb}MB，已跳过。可在「更多参数」的文档限制里调整。`,
          variant: "destructive",
        })
      }

      const validFiles = files.filter((file) => file.size <= maxBytes)
      if (validFiles.length === 0) {
        event.target.value = ""
        return
      }
      if (validFiles.length > MAX_FILES_PER_BATCH) {
        toast({
          title: "文件数量超限",
          description: `单次最多上传 ${MAX_FILES_PER_BATCH} 个文件，请分批上传。`,
          variant: "destructive",
        })
        event.target.value = ""
        return
      }

      setUploading(true)
      setUploadProgress(0)
      setUploadingFiles(validFiles.map((file) => ({ name: file.name, progress: 0, status: "pending" })))

      try {
        const formData = new FormData()
        validFiles.forEach((file) => formData.append("files", file))
        const totalSize = validFiles.reduce((sum, file) => sum + file.size, 0)

        const res = await apiHttpClient.post<
          ApiResponse<{
            results: Array<{ fileName: string; documentId?: number; error?: string }>
            summary: { total: number; success: number; failed: number }
          }>
        >(`/knowledge-bases/${knowledgeBaseId}/documents/batch-upload`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: calculateTimeout(totalSize),
          onUploadProgress: (progressEvent) => {
            if (!progressEvent.total) return
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            setUploadProgress(percent)
            setUploadingFiles((prev) =>
              prev.map((file) => ({ ...file, progress: percent, status: "uploading" })),
            )
          },
        })

        if (!res.data.success || !res.data.data) throw new Error(res.data.error || "上传失败")

        const { results, summary } = res.data.data
        setUploadingFiles((prev) =>
          prev.map((file) => {
            const result = results.find((item) => item.fileName === file.name)
            if (result?.documentId) return { ...file, progress: 100, status: "success" }
            if (result?.error) return { ...file, progress: 100, status: "error", error: result.error }
            return file
          }),
        )

        if (summary.failed > 0) {
          toast({
            title: `上传完成：${summary.success} 成功，${summary.failed} 失败`,
            description: "部分文档上传失败，请检查文件格式或稍后重试",
            variant: summary.success > 0 ? "default" : "destructive",
          })
        } else {
          toast({ title: `${summary.success} 个文档上传成功`, description: "正在解析中，请稍候..." })
        }

        await onUploaded()
        setTimeout(reset, 2000)
      } catch (error) {
        toast({
          title: "上传失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          variant: "destructive",
        })
        reset()
      } finally {
        event.target.value = ""
      }
    },
    [knowledgeBaseId, maxFileSizeMb, onUploaded, reset, toast],
  )

  return { uploading, uploadProgress, uploadingFiles, upload }
}
