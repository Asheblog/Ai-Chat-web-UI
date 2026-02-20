"use client"

import { useEffect, useState, useCallback } from "react"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useToast } from "@/components/ui/use-toast"
import { BookOpen, Plus, Trash2, Upload, FileText, RefreshCw, MoreHorizontal, Loader2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { apiHttpClient } from "@/lib/api"
import type { ApiResponse } from "@/types"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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

interface KnowledgeBaseDocument {
  id: number
  originalName: string
  mimeType: string
  fileSize: number
  status: string
  chunkCount: number
  addedAt: string
  processingStage?: string
  processingProgress?: number
  errorMessage?: string
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

// 获取处理阶段的显示文本
const getStageText = (stage?: string): string => {
  switch (stage) {
    case 'parsing':
      return '解析文档'
    case 'chunking':
      return '分块处理'
    case 'embedding':
      return '生成向量'
    case 'storing':
      return '存储数据'
    case 'done':
      return '完成'
    case 'error':
      return '失败'
    default:
      return ''
  }
}

export function SystemKnowledgeBasePage() {
  const {
    settings: systemSettings,
    refresh: fetchSystemSettings,
    update: updateSystemSettings,
    isLoading,
    error,
  } = useSystemSettings()
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
  const [uploadingFiles, setUploadingFiles] = useState<Array<{
    name: string
    progress: number
    status: 'pending' | 'uploading' | 'success' | 'error'
    error?: string
  }>>([])

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
    fetchSystemSettings().catch(() => { })
    fetchKnowledgeBases().catch(() => { })
  }, [fetchSystemSettings, fetchKnowledgeBases])

  useEffect(() => {
    if (!systemSettings) return
    setEnabled(Boolean((systemSettings as any).knowledgeBaseEnabled ?? false))
    setAllowAnonymous(Boolean((systemSettings as any).knowledgeBaseAllowAnonymous ?? false))
    setAllowUsers(Boolean((systemSettings as any).knowledgeBaseAllowUsers ?? true))
  }, [systemSettings])

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
      await updateSystemSettings({
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

  const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
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

  if (isLoading && !systemSettings) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!systemSettings) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>{error || "无法加载系统设置"}</p>
        <Button variant="outline" className="mt-3" onClick={() => fetchSystemSettings()}>
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-start gap-3">
        <BookOpen className="h-6 w-6 text-muted-foreground mt-0.5" />
        <div>
          <CardTitle className="text-lg">知识库管理</CardTitle>
          <CardDescription className="mt-1">
            创建和管理持久化的知识库，用户可以在聊天时选择启用知识库进行问答
          </CardDescription>
        </div>
      </div>

      <Alert>
        <AlertDescription>
          知识库与文档附件不同，知识库是持久化的，可以在多个会话中使用。管理员可以在此创建系统级知识库供所有用户使用。
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        {/* 启用开关 */}
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <p className="font-medium">启用知识库功能</p>
            <p className="text-sm text-muted-foreground">
              允许用户在聊天时选择并使用知识库
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <>
            {/* 权限设置 */}
            <div className="space-y-3 border-b pb-4">
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

            {/* 知识库列表 */}
            <div className="space-y-3">
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
                <div className="text-center py-8 text-muted-foreground border rounded-lg">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>暂无知识库</p>
                  <p className="text-sm">点击上方按钮创建第一个知识库</p>
                </div>
              ) : (
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
                          {formatDate(kb.updatedAt)}
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
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end pt-4 border-t">
        <Button onClick={handleSaveSettings}>保存设置</Button>
      </div>

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
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedKb?.name}</DialogTitle>
            <DialogDescription>
              {selectedKb?.description || "管理知识库中的文档"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  共 {kbDocuments.length} 个文档
                </span>
                <div>
                  <input
                    type="file"
                    id="kb-upload"
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls"
                    onChange={handleUploadDocument}
                    disabled={uploading}
                    multiple
                  />
                  <Button
                    size="sm"
                    onClick={() => document.getElementById('kb-upload')?.click()}
                    disabled={uploading}
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    {uploading ? "上传中..." : "上传文档"}
                  </Button>
                </div>
              </div>
              
              {/* 上传进度条 */}
              {uploading && uploadingFiles.length > 0 && (
                <div className="p-3 border rounded-lg bg-muted/50 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      正在上传 {uploadingFiles.length} 个文件
                    </span>
                    <span className="text-muted-foreground">
                      {uploadProgress < 100 ? `${uploadProgress}%` : '处理中...'}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded bg-muted">
                    <div
                      className="h-2 rounded bg-primary transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <div className="max-h-[150px] overflow-y-auto space-y-1">
                    {uploadingFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between text-xs">
                        <span className="truncate max-w-[200px]">{file.name}</span>
                        <span className={
                          file.status === 'success' ? 'text-[hsl(var(--success))]' :
                          file.status === 'error' ? 'text-destructive' :
                          'text-muted-foreground'
                        }>
                          {file.status === 'pending' && '等待中'}
                          {file.status === 'uploading' && '上传中'}
                          {file.status === 'success' && '✓ 成功'}
                          {file.status === 'error' && `✗ ${file.error || '失败'}`}
                        </span>
                      </div>
                    ))}
                  </div>
                  {uploadProgress === 100 && uploadingFiles.every(f => f.status === 'uploading') && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      文件已上传，正在等待服务器处理...
                    </p>
                  )}
                </div>
              )}
            </div>

            {docsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : kbDocuments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border rounded-lg">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>暂无文档</p>
                <p className="text-sm">上传文档以构建知识库</p>
              </div>
            ) : (
              <>
                {/* 批量操作栏 */}
                <div className="flex items-center justify-between py-2 border-b">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedDocIds.size === kbDocuments.length && kbDocuments.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                    <span className="text-sm text-muted-foreground">
                      {selectedDocIds.size > 0 ? `已选择 ${selectedDocIds.size} 项` : '全选'}
                    </span>
                  </div>
                  {selectedDocIds.size > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBatchRemoveDocuments}
                      disabled={batchDeleting}
                    >
                      {batchDeleting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          删除中...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4 mr-1" />
                          批量删除 ({selectedDocIds.size})
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <div className="max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>文件名</TableHead>
                        <TableHead>大小</TableHead>
                        <TableHead>分块</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kbDocuments.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <Checkbox
                              checked={selectedDocIds.has(doc.id)}
                              onCheckedChange={() => toggleSelectDoc(doc.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate max-w-[200px]">{doc.originalName}</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatFileSize(doc.fileSize)}</TableCell>
                          <TableCell>{doc.chunkCount}</TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded ${doc.status === 'ready'
                                  ? 'border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]'
                                  : doc.status === 'processing'
                                    ? 'border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]'
                                    : doc.status === 'error'
                                      ? 'border border-destructive/30 bg-destructive/10 text-destructive'
                                      : 'border border-border/70 bg-[hsl(var(--surface-hover))] text-muted-foreground'
                                  }`}>
                                  {doc.status === 'ready' ? '就绪' :
                                    doc.status === 'processing' ? '处理中' :
                                      doc.status === 'error' ? '错误' :
                                        doc.status === 'pending' ? '等待中' : doc.status}
                                </span>
                                {(doc.status === 'processing' || doc.status === 'pending') && (
                                  <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--warning))]" />
                                )}
                              </div>
                              {/* 显示处理阶段和进度 */}
                              {(doc.status === 'processing' || doc.status === 'pending') && (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <span>{getStageText(doc.processingStage) || '准备中'}</span>
                                    {typeof doc.processingProgress === 'number' && (
                                      <span>({doc.processingProgress}%)</span>
                                    )}
                                  </div>
                                  {typeof doc.processingProgress === 'number' && (
                                    <div className="h-1.5 w-20 rounded bg-muted">
                                      <div
                                        className="h-1.5 rounded bg-[hsl(var(--warning))] transition-all"
                                        style={{ width: `${Math.min(100, doc.processingProgress)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                              {/* 显示错误信息 */}
                              {doc.status === 'error' && doc.errorMessage && (
                                <p className="text-xs text-destructive truncate max-w-[150px]" title={doc.errorMessage}>
                                  {doc.errorMessage}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleRemoveDocument(doc.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
