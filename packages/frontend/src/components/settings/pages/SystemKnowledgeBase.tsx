"use client"

import { useEffect, useState, useCallback } from "react"
import { CardDescription, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSystemSettings } from "@/hooks/use-system-settings"
import { useToast } from "@/components/ui/use-toast"
import { BookOpen, Plus, Trash2, Upload, FileText, RefreshCw, MoreHorizontal } from "lucide-react"
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

    const file = e.target.files[0]
    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await apiHttpClient.post<ApiResponse<any>>(
        `/knowledge-bases/${selectedKb.id}/documents/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )

      if (res.data.success) {
        toast({ title: "文档上传成功", description: "正在解析中..." })
        fetchKbDetail(selectedKb.id)
        fetchKnowledgeBases()
      } else {
        throw new Error(res.data.error || 'Upload failed')
      }
    } catch (e: any) {
      toast({
        title: "上传失败",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setUploading(false)
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
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
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
              <div className="max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
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
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate max-w-[200px]">{doc.originalName}</span>
                          </div>
                        </TableCell>
                        <TableCell>{formatFileSize(doc.fileSize)}</TableCell>
                        <TableCell>{doc.chunkCount}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded ${doc.status === 'ready'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : doc.status === 'processing'
                              ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                              : doc.status === 'error'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                            }`}>
                            {doc.status === 'ready' ? '就绪' :
                              doc.status === 'processing' ? '处理中' :
                                doc.status === 'error' ? '错误' : doc.status}
                          </span>
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
