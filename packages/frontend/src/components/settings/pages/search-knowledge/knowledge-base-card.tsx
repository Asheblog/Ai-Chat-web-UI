"use client"

import { useEffect, useState, useCallback } from "react"
import type { ChangeEvent } from "react"
import { BookOpen, FileText, MoreHorizontal, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { FeatureCard } from "@/components/settings/components/feature-card"
import type { ApiResponse, SystemSettings } from "@/types"
import { formatDateTime } from "@/features/settings/shared"
import { apiHttpClient } from "@/lib/api"
import {
  KnowledgeBaseDetailDialog,
  type KnowledgeBaseDocument,
  type UploadingFile,
} from "./knowledge-base-detail-dialog"

interface KnowledgeBase {
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

// 最大文件大小限制（默认100MB，应与后端配置一致）
const MAX_FILE_SIZE_MB = 100
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

// 根据文件大小计算超时时间（基础30秒 + 每10MB增加30秒）
const calculateTimeout = (fileSize: number) => {
  const baseTimeout = 30000
  const additionalTimeout = Math.ceil(fileSize / (10 * 1024 * 1024)) * 30000
  return baseTimeout + additionalTimeout
}

export interface KnowledgeBaseCardProps {
  settings: SystemSettings
  update: (payload: Partial<SystemSettings>) => Promise<void>
  refresh: () => Promise<void>
  isLoading: boolean
}

export function KnowledgeBaseCard({ settings, update }: KnowledgeBaseCardProps) {
  const { toast } = useToast()

  const [enabled, setEnabled] = useState(false)
  const [allowAnonymous, setAllowAnonymous] = useState(false)
  const [allowUsers, setAllowUsers] = useState(true)

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([])
  const [kbLoading, setKbLoading] = useState(false)

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newKbName, setNewKbName] = useState("")
  const [newKbDescription, setNewKbDescription] = useState("")
  const [creating, setCreating] = useState(false)

  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null)
  const [kbDocuments, setKbDocuments] = useState<KnowledgeBaseDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])

  // 批量删除相关状态
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)

  const fetchKnowledgeBases = useCallback(async () => {
    setKbLoading(true)
    try {
      const res = await apiHttpClient.get<ApiResponse<KnowledgeBase[]>>('/knowledge-bases/admin')
      if (res.data.success && res.data.data) {
        setKnowledgeBases(res.data.data)
      }
    } catch (e) {
      console.error('Failed to fetch knowledge bases:', e)
    } finally {
      setKbLoading(false)
    }
  }, [])

  const fetchKbDetail = useCallback(async (id: number) => {
    setDocsLoading(true)
    try {
      const res = await apiHttpClient.get<ApiResponse<{
        documents: KnowledgeBaseDocument[]
      }>>(`/knowledge-bases/${id}`)
      if (res.data.success && res.data.data) {
        setKbDocuments(res.data.data.documents || [])
      }
    } catch (e) {
      console.error('Failed to fetch knowledge base detail:', e)
    } finally {
      setDocsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKnowledgeBases().catch(() => {})
  }, [fetchKnowledgeBases])

  useEffect(() => {
    setEnabled(Boolean(settings.knowledgeBaseEnabled ?? false))
    setAllowAnonymous(Boolean(settings.knowledgeBaseAllowAnonymous ?? false))
    setAllowUsers(Boolean(settings.knowledgeBaseAllowUsers ?? true))
  }, [settings])

  useEffect(() => {
    if (selectedKb) {
      fetchKbDetail(selectedKb.id)
    }
  }, [selectedKb, fetchKbDetail])

  // 自动轮询处理中的文档状态
  useEffect(() => {
    if (!detailDialogOpen || !selectedKb) return

    const hasPendingDocs = kbDocuments.some(
      (doc) => doc.status === 'pending' || doc.status === 'processing'
    )

    if (!hasPendingDocs) return

    const interval = setInterval(() => {
      fetchKbDetail(selectedKb.id)
      fetchKnowledgeBases() // 同时更新知识库列表的分块数
    }, 5000) // 每5秒刷新一次

    return () => clearInterval(interval)
  }, [detailDialogOpen, selectedKb, kbDocuments, fetchKbDetail, fetchKnowledgeBases])

  const handleSaveSettings = async () => {
    try {
      await update({
        knowledgeBaseEnabled: enabled,
        knowledgeBaseAllowAnonymous: allowAnonymous,
        knowledgeBaseAllowUsers: allowUsers,
      } as any)
      toast({ title: "知识库设置已保存" })
    } catch (e: any) {
      toast({
        title: "保存失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const handleCreateKb = async () => {
    if (!newKbName.trim()) {
      toast({ title: "请输入知识库名称", variant: "destructive" })
      return
    }

    setCreating(true)
    try {
      const res = await apiHttpClient.post<ApiResponse<KnowledgeBase>>('/knowledge-bases', {
        name: newKbName.trim(),
        description: newKbDescription.trim() || undefined,
        isPublic: true,
      })
      if (res.data.success) {
        toast({ title: "知识库创建成功" })
        setCreateDialogOpen(false)
        setNewKbName("")
        setNewKbDescription("")
        fetchKnowledgeBases()
      } else {
        throw new Error(res.data.error || 'Failed')
      }
    } catch (e: any) {
      toast({
        title: "创建失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteKb = async (id: number) => {
    if (!confirm('确定要删除这个知识库吗？')) return

    try {
      const res = await apiHttpClient.delete<ApiResponse<any>>(`/knowledge-bases/${id}`)
      if (res.data.success) {
        toast({ title: "知识库已删除" })
        fetchKnowledgeBases()
        if (selectedKb?.id === id) {
          setDetailDialogOpen(false)
          setSelectedKb(null)
        }
      }
    } catch (e: any) {
      toast({
        title: "删除失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const handleUploadDocument = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!selectedKb || !e.target.files?.length) return

    const files = Array.from(e.target.files)

    // 文件大小预检查
    const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE_BYTES)
    if (oversizedFiles.length > 0) {
      toast({
        title: "部分文件过大",
        description: `${oversizedFiles.map(f => f.name).join(', ')} 超过限制 ${MAX_FILE_SIZE_MB}MB，已跳过这些文件。`,
        variant: "destructive",
      })
    }

    // 过滤掉超大文件
    const validFiles = files.filter(f => f.size <= MAX_FILE_SIZE_BYTES)
    if (validFiles.length === 0) {
      e.target.value = ''
      return
    }

    // 检查最大批量上传数量
    const MAX_FILES_PER_BATCH = 20
    if (validFiles.length > MAX_FILES_PER_BATCH) {
      toast({
        title: "文件数量超限",
        description: `单次最多上传 ${MAX_FILES_PER_BATCH} 个文件，请分批上传。`,
        variant: "destructive",
      })
      e.target.value = ''
      return
    }

    setUploading(true)
    setUploadProgress(0)
    setUploadingFiles(validFiles.map(f => ({
      name: f.name,
      progress: 0,
      status: 'pending' as const
    })))

    try {
      const formData = new FormData()
      validFiles.forEach(file => {
        formData.append('files', file)
      })

      // 根据所有文件总大小计算超时时间
      const totalSize = validFiles.reduce((sum, f) => sum + f.size, 0)
      const timeout = calculateTimeout(totalSize)

      const res = await apiHttpClient.post<ApiResponse<{
        results: Array<{
          fileName: string
          documentId?: number
          status?: string
          error?: string
        }>
        summary: {
          total: number
          success: number
          failed: number
        }
      }>>(
        `/knowledge-bases/${selectedKb.id}/documents/batch-upload`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout,
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
              setUploadProgress(percent)
              // 更新所有文件为上传中状态
              setUploadingFiles(prev => prev.map(f => ({
                ...f,
                progress: percent,
                status: 'uploading' as const
              })))
            }
          }
        }
      )

      if (res.data.success && res.data.data) {
        const { results, summary } = res.data.data

        // 更新每个文件的最终状态
        setUploadingFiles(prev => prev.map(f => {
          const result = results.find(r => r.fileName === f.name)
          if (result?.documentId) {
            return { ...f, progress: 100, status: 'success' as const }
          } else if (result?.error) {
            return { ...f, progress: 100, status: 'error' as const, error: result.error }
          }
          return f
        }))

        if (summary.failed > 0) {
          toast({
            title: `上传完成：${summary.success} 成功，${summary.failed} 失败`,
            description: "部分文档上传失败，请检查文件格式或稍后重试",
            variant: summary.success > 0 ? "default" : "destructive"
          })
        } else {
          toast({
            title: `${summary.success} 个文档上传成功`,
            description: "正在解析中，请稍候..."
          })
        }

        fetchKbDetail(selectedKb.id)
        fetchKnowledgeBases()

        // 延迟清除上传状态，让用户看到结果
        setTimeout(() => {
          setUploading(false)
          setUploadProgress(0)
          setUploadingFiles([])
        }, 2000)
      } else {
        throw new Error(res.data.error || 'Upload failed')
      }
    } catch (e: any) {
      // 区分超时错误和其他错误
      let errorMessage = e?.message || "请稍后重试"
      if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
        errorMessage = `上传超时，文件较大可能需要更长时间。请检查网络连接后重试。`
      }
      toast({
        title: "上传失败",
        description: errorMessage,
        variant: "destructive",
      })
      setUploading(false)
      setUploadProgress(0)
      setUploadingFiles([])
    } finally {
      e.target.value = ''
    }
  }

  const handleRemoveDocument = async (docId: number) => {
    if (!selectedKb) return

    try {
      const res = await apiHttpClient.delete<ApiResponse<any>>(
        `/knowledge-bases/${selectedKb.id}/documents/${docId}`
      )
      if (res.data.success) {
        toast({ title: "文档已移除" })
        fetchKbDetail(selectedKb.id)
        fetchKnowledgeBases()
      }
    } catch (e: any) {
      toast({
        title: "移除失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  const handleBatchRemoveDocuments = async () => {
    if (!selectedKb || selectedDocIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedDocIds.size} 个文档吗？`)) return

    setBatchDeleting(true)
    try {
      const res = await apiHttpClient.post<ApiResponse<any>>(
        `/knowledge-bases/${selectedKb.id}/documents/batch-remove`,
        { documentIds: Array.from(selectedDocIds) }
      )
      if (res.data.success) {
        toast({ title: `已删除 ${res.data.data.deleted} 个文档` })
        setSelectedDocIds(new Set())
        fetchKbDetail(selectedKb.id)
        fetchKnowledgeBases()
      }
    } catch (e: any) {
      toast({
        title: "批量删除失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setBatchDeleting(false)
    }
  }

  const toggleSelectDoc = (docId: number) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev)
      if (next.has(docId)) {
        next.delete(docId)
      } else {
        next.add(docId)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedDocIds.size === kbDocuments.length) {
      setSelectedDocIds(new Set())
    } else {
      setSelectedDocIds(new Set(kbDocuments.map(d => d.id)))
    }
  }

  const handleRefreshStats = async (kbId: number) => {
    try {
      const res = await apiHttpClient.post<ApiResponse<any>>(
        `/knowledge-bases/${kbId}/refresh-stats`
      )
      if (res.data.success) {
        toast({ title: "统计信息已刷新" })
        fetchKnowledgeBases()
      }
    } catch (e: any) {
      toast({
        title: "刷新失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    }
  }

  return (
    <>
      <FeatureCard
        icon={BookOpen}
        title="知识库"
        description="创建和管理持久化知识库，供所有用户使用"
        cardKey="search-knowledge:knowledge-base"
        enabled={enabled}
        onEnabledChange={setEnabled}
        footer={
          <div className="flex justify-end">
            <Button onClick={handleSaveSettings}>保存设置</Button>
          </div>
        }
      >
        {enabled && (
          <>
            <div className="space-y-3 border-b border-border py-4">
              <h4 className="font-medium">用户权限</h4>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">允许匿名用户使用</p>
                  <p className="text-xs text-muted-foreground">未登录用户是否可以使用知识库</p>
                </div>
                <Switch checked={allowAnonymous} onCheckedChange={setAllowAnonymous} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">允许注册用户使用</p>
                  <p className="text-xs text-muted-foreground">已登录用户是否可以使用知识库</p>
                </div>
                <Switch checked={allowUsers} onCheckedChange={setAllowUsers} />
              </div>
            </div>

            <div className="space-y-3 pt-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">知识库列表</h4>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchKnowledgeBases()}
                    disabled={kbLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-1 ${kbLoading ? 'animate-spin' : ''}`} />
                    刷新
                  </Button>
                  <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    新建知识库
                  </Button>
                </div>
              </div>

              {kbLoading && knowledgeBases.length === 0 ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : knowledgeBases.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-border py-8 text-center text-muted-foreground">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>暂无知识库</p>
                  <p className="text-sm">点击上方按钮创建第一个知识库</p>
                </div>
              ) : (
                <div className="v2-table-wrap">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>名称</TableHead>
                      <TableHead>文档数</TableHead>
                      <TableHead>分块数</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>更新时间</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {knowledgeBases.map((kb) => (
                      <TableRow key={kb.id}>
                        <TableCell>
                          <button
                            className="font-medium hover:underline text-left"
                            onClick={() => {
                              setSelectedKb(kb)
                              setDetailDialogOpen(true)
                            }}
                          >
                            {kb.name}
                          </button>
                          {kb.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {kb.description}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>{kb.documentCount}</TableCell>
                        <TableCell>{kb.totalChunks}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded ${kb.status === 'active'
                            ? 'border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]'
                            : 'border border-border/70 bg-[hsl(var(--surface-hover))] text-muted-foreground'
                            }`}>
                            {kb.status === 'active' ? '启用' : '禁用'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(kb.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => {
                                  setSelectedKb(kb)
                                  setDetailDialogOpen(true)
                                }}
                              >
                                <FileText className="h-4 w-4 mr-2" />
                                查看文档
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleRefreshStats(kb.id)}
                              >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                刷新统计
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDeleteKb(kb.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </div>
          </>
        )}
      </FeatureCard>

      {/* 创建知识库对话框 */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建知识库</DialogTitle>
            <DialogDescription>
              创建一个新的知识库，然后可以向其中添加文档
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">名称</label>
              <Input
                placeholder="输入知识库名称"
                value={newKbName}
                onChange={(e) => setNewKbName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">描述（可选）</label>
              <Input
                placeholder="输入知识库描述"
                value={newKbDescription}
                onChange={(e) => setNewKbDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreateKb} disabled={creating}>
              {creating ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 知识库详情对话框 */}
      <KnowledgeBaseDetailDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        selectedKb={selectedKb}
        kbDocuments={kbDocuments}
        docsLoading={docsLoading}
        uploading={uploading}
        uploadProgress={uploadProgress}
        uploadingFiles={uploadingFiles}
        selectedDocIds={selectedDocIds}
        batchDeleting={batchDeleting}
        onToggleSelectAll={toggleSelectAll}
        onToggleSelect={toggleSelectDoc}
        onBatchRemove={handleBatchRemoveDocuments}
        onRemoveDocument={handleRemoveDocument}
        onUpload={handleUploadDocument}
      />
    </>
  )
}
