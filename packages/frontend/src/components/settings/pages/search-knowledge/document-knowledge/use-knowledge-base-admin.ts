"use client"

import { useCallback, useEffect, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import type { ApiResponse } from "@/types"
import { apiHttpClient } from "@/lib/api"
import type { KnowledgeBaseDocument } from "../knowledge-base-detail-dialog"

export interface KnowledgeBaseRow {
  id: number
  name: string
  description: string | null
  isPublic: boolean
  status: string
  documentCount: number
  totalChunks: number
  createdAt: string
  updatedAt: string
}

const readError = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

/**
 * 知识库管理数据层：列表、详情、处理中轮询与增删操作。
 * 只做管理面动作（管理员身份），用户消费面的准入由服务端策略负责。
 */
export function useKnowledgeBaseAdmin() {
  const { toast } = useToast()

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedKb, setSelectedKb] = useState<KnowledgeBaseRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [documents, setDocuments] = useState<KnowledgeBaseDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiHttpClient.get<ApiResponse<KnowledgeBaseRow[]>>("/knowledge-bases/admin")
      if (res.data.success && res.data.data) setKnowledgeBases(res.data.data)
    } catch (error) {
      console.error("Failed to fetch knowledge bases:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchDetail = useCallback(async (id: number) => {
    setDocsLoading(true)
    try {
      const res = await apiHttpClient.get<ApiResponse<{ documents: KnowledgeBaseDocument[] }>>(
        `/knowledge-bases/${id}`,
      )
      if (res.data.success && res.data.data) setDocuments(res.data.data.documents || [])
    } catch (error) {
      console.error("Failed to fetch knowledge base detail:", error)
    } finally {
      setDocsLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  useEffect(() => {
    if (selectedKb) void fetchDetail(selectedKb.id)
  }, [selectedKb, fetchDetail])

  useEffect(() => {
    if (!detailOpen || !selectedKb) return
    const hasPending = documents.some(
      (doc) => doc.status === "pending" || doc.status === "processing",
    )
    if (!hasPending) return
    const timer = setInterval(() => {
      void fetchDetail(selectedKb.id)
      void fetchList()
    }, 5000)
    return () => clearInterval(timer)
  }, [detailOpen, selectedKb, documents, fetchDetail, fetchList])

  const openDetail = (kb: KnowledgeBaseRow) => {
    setSelectedKb(kb)
    setDetailOpen(true)
  }

  const create = async (input: { name: string; description?: string }) => {
    const res = await apiHttpClient.post<ApiResponse<KnowledgeBaseRow>>("/knowledge-bases", {
      name: input.name,
      description: input.description,
      isPublic: true,
    })
    if (!res.data.success) throw new Error(res.data.error || "创建失败")
    await fetchList()
  }

  const remove = async (kb: KnowledgeBaseRow) => {
    try {
      const res = await apiHttpClient.delete<ApiResponse<unknown>>(`/knowledge-bases/${kb.id}`)
      if (res.data.success) {
        toast({ title: "知识库已删除" })
        await fetchList()
        if (selectedKb?.id === kb.id) {
          setDetailOpen(false)
          setSelectedKb(null)
        }
      }
    } catch (error) {
      toast({ title: "删除失败", description: readError(error, "请稍后重试"), variant: "destructive" })
    }
  }

  const refreshStats = async (kb: KnowledgeBaseRow) => {
    try {
      const res = await apiHttpClient.post<ApiResponse<unknown>>(
        `/knowledge-bases/${kb.id}/refresh-stats`,
      )
      if (res.data.success) {
        toast({ title: "统计信息已刷新" })
        await fetchList()
      }
    } catch (error) {
      toast({ title: "刷新失败", description: readError(error, "请稍后重试"), variant: "destructive" })
    }
  }

  const removeDocument = async (docId: number) => {
    if (!selectedKb) return
    try {
      const res = await apiHttpClient.delete<ApiResponse<unknown>>(
        `/knowledge-bases/${selectedKb.id}/documents/${docId}`,
      )
      if (res.data.success) {
        toast({ title: "文档已移除" })
        await fetchDetail(selectedKb.id)
        await fetchList()
      }
    } catch (error) {
      toast({ title: "移除失败", description: readError(error, "请稍后重试"), variant: "destructive" })
    }
  }

  const batchRemove = async () => {
    if (!selectedKb || selectedDocIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedDocIds.size} 个文档吗？`)) return
    setBatchDeleting(true)
    try {
      const res = await apiHttpClient.post<ApiResponse<{ deleted: number }>>(
        `/knowledge-bases/${selectedKb.id}/documents/batch-remove`,
        { documentIds: Array.from(selectedDocIds) },
      )
      if (res.data.success) {
        toast({ title: `已删除 ${res.data.data?.deleted ?? selectedDocIds.size} 个文档` })
        setSelectedDocIds(new Set())
        await fetchDetail(selectedKb.id)
        await fetchList()
      }
    } catch (error) {
      toast({ title: "批量删除失败", description: readError(error, "请稍后重试"), variant: "destructive" })
    } finally {
      setBatchDeleting(false)
    }
  }

  const toggleSelectDoc = (docId: number) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  const toggleSelectAll = () => {
    setSelectedDocIds((prev) =>
      prev.size === documents.length ? new Set() : new Set(documents.map((doc) => doc.id)),
    )
  }

  return {
    knowledgeBases,
    loading,
    selectedKb,
    detailOpen,
    setDetailOpen,
    documents,
    docsLoading,
    selectedDocIds,
    setSelectedDocIds,
    batchDeleting,
    fetchList,
    fetchDetail,
    openDetail,
    create,
    remove,
    refreshStats,
    removeDocument,
    batchRemove,
    toggleSelectDoc,
    toggleSelectAll,
  }
}
