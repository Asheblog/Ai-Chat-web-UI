"use client"

import { useCallback, useMemo, useState } from "react"
import { FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import type { ApiResponse } from "@/types"
import { apiHttpClient } from "@/lib/api"
import { DocManageDialog, type DocumentItem } from "../doc-manage-dialog"

/**
 * RAG 文档库（全局文档池）管理：查看已解析文档、批量删除、单删、刷新。
 * 纯运维动作，属于「文档解析」能力本身，与知识库的文档集合分开。
 */
export function RagDocumentsPanel() {
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiHttpClient.get<ApiResponse<DocumentItem[]>>("/documents/admin/all")
      if (res.data.success && res.data.data) {
        setDocuments(res.data.data)
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error)
      toast({ title: "获取文档列表失败", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  const filteredDocuments = useMemo(
    () =>
      documents.filter((doc) => {
        const matchesSearch =
          searchQuery === "" || doc.originalName.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesStatus = statusFilter === "all" || doc.status === statusFilter
        return matchesSearch && matchesStatus
      }),
    [documents, searchQuery, statusFilter],
  )

  const toggleSelectDoc = (id: number) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllDocs = () => {
    setSelectedDocIds((prev) =>
      prev.size === filteredDocuments.length
        ? new Set()
        : new Set(filteredDocuments.map((doc) => doc.id)),
    )
  }

  const handleBatchDeleteDocs = async () => {
    if (selectedDocIds.size === 0) return
    if (
      !confirm(
        `确定要删除选中的 ${selectedDocIds.size} 个文档吗？\n\n这将同时删除：\n• 文档文件\n• 向量数据\n• 数据库记录\n\n并执行 VACUUM 释放空间。`,
      )
    ) {
      return
    }

    setBatchDeleting(true)
    try {
      const res = await apiHttpClient.post<
        ApiResponse<{ deleted: number; failed: number; requested: number }>
      >("/documents/batch-delete", { documentIds: Array.from(selectedDocIds) })
      if (res.data.success && res.data.data) {
        toast({
          title: `成功删除 ${res.data.data.deleted} 个文档`,
          description:
            res.data.data.failed > 0
              ? `${res.data.data.failed} 个文档删除失败`
              : "向量数据已清理，空间已释放",
        })
        setSelectedDocIds(new Set())
        fetchDocuments()
      }
    } catch (error) {
      toast({
        title: "批量删除失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setBatchDeleting(false)
    }
  }

  const handleDeleteSingleDoc = async (id: number) => {
    if (!confirm("确定要删除这个文档吗？")) return
    try {
      const res = await apiHttpClient.delete<ApiResponse<unknown>>(`/documents/${id}`)
      if (res.data.success) {
        toast({ title: "文档已删除" })
        fetchDocuments()
      }
    } catch (error) {
      toast({
        title: "删除失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const openDialog = () => {
    setOpen(true)
    void fetchDocuments()
  }

  return (
    <>
      <Button variant="outline" onClick={openDialog}>
        <FolderOpen className="mr-2 h-4 w-4" />
        文档管理
      </Button>
      <DocManageDialog
        open={open}
        onOpenChange={setOpen}
        documents={filteredDocuments}
        loading={loading}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        selectedDocIds={selectedDocIds}
        batchDeleting={batchDeleting}
        onToggleSelectAll={toggleSelectAllDocs}
        onToggleSelect={toggleSelectDoc}
        onBatchDelete={handleBatchDeleteDocs}
        onDeleteSingle={handleDeleteSingleDoc}
        onClearSelection={() => setSelectedDocIds(new Set())}
        onRefresh={fetchDocuments}
      />
    </>
  )
}
