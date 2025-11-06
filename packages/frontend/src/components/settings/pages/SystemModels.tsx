"use client"
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardTitle, CardDescription } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useModelsStore } from '@/store/models-store'
import { apiClient } from '@/lib/api'
import {
  Cpu,
  MoreVertical,
  RefreshCw,
  Search,
  Download,
  Upload,
  Trash2,
  RotateCcw,
  Eye,
  FileUp,
  Globe,
  Image as ImageIcon,
  Code2,
  HelpCircle
} from 'lucide-react'

const CAP_KEYS = ['vision','file_upload','web_search','image_generation','code_interpreter'] as const
type CapKey = typeof CAP_KEYS[number]
type SortField = 'name' | 'provider'
type SortOrder = 'asc' | 'desc'

// 显示用中文标签(仅影响 UI 文案,不改变接口键名)
const CAP_LABELS: Record<CapKey, string> = {
  vision: '图片理解',
  file_upload: '文件上传',
  web_search: '联网搜索',
  image_generation: '图像生成',
  code_interpreter: '代码解释器',
}

const CAP_ICONS: Record<CapKey, React.ElementType> = {
  vision: Eye,
  file_upload: FileUp,
  web_search: Globe,
  image_generation: ImageIcon,
  code_interpreter: Code2,
}

export function SystemModelsPage() {
  const { models, isLoading, fetchAll } = useModelsStore()
  const [q, setQ] = useState('')
  const [onlyOverridden, setOnlyOverridden] = useState(false)
  const [saving, setSaving] = useState<string>('') // key `${cid}:${id}`
  const [refreshing, setRefreshing] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 排序状态
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // 批量选择状态
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchAll().catch(() => {})
  }, [fetchAll])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    let filtered = (models || []).filter((m:any) => {
      if (!kw) return true
      return [m.id, m.rawId, m.name, m.provider].some((s)=>String(s||'').toLowerCase().includes(kw))
    }).filter((m:any)=> onlyOverridden ? m?.overridden : true)

    // 排序
    filtered.sort((a:any, b:any) => {
      let comparison = 0
      if (sortField === 'name') {
        comparison = (a.name || a.id || '').localeCompare(b.name || b.id || '')
      } else if (sortField === 'provider') {
        comparison = (a.provider || '').localeCompare(b.provider || '')
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [models, q, onlyOverridden, sortField, sortOrder])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const has = (m:any, k:CapKey) => Boolean(m?.capabilities?.[k])

  // 简单启发式:给出"推荐用途"标签(无后端字段时的友好占位)
  const recommendTag = (m:any): string | null => {
    const key = `${m?.id||''} ${m?.name||''} ${m?.rawId||''}`.toLowerCase()
    if (/reason|math|logic|deepseek-reasoner/.test(key)) return '推荐:推理/数学'
    if (/image-gen|image_generation|dall|sd|flux|kandinsky/.test(key)) return '推荐:图像生成'
    if (/vision|vl|4o|gpt-4o|omni|gpt-4v/.test(key)) return '推荐:多模态'
    if (/embed|embedding/.test(key)) return '推荐:嵌入/检索'
    return '推荐:通用对话'
  }

  const onToggle = (m:any, k:CapKey, v:boolean) => {
    const tags = Array.isArray(m.tags) ? m.tags.map((t:any)=>({ name: String(t?.name||'') })) : []
    const base = tags.filter((t:any)=>!CAP_KEYS.includes(t.name as CapKey))
    const caps = new Set<CapKey>(CAP_KEYS.filter((kk)=>has(m, kk)) as CapKey[])
    if (v) caps.add(k); else caps.delete(k)
    const newTags = base.concat(Array.from(caps).map(n => ({ name: n })))
    return newTags
  }

  const saveCaps = async (m:any, newTags:Array<{name:string}>) => {
    try {
      setSaving(`${m.connectionId}:${m.id}`)
      await apiClient.updateModelTags(m.connectionId, m.rawId, newTags)
      await fetchAll()
      toast({ title: '能力已更新', description: `${m.name || m.id} 的能力配置已保存` })
    } catch (e: any) {
      toast({
        title: '更新失败',
        description: e?.message || '保存失败',
        variant: 'destructive',
      })
    } finally {
      setSaving('')
    }
  }

  const keyOf = (m:any) => `${m.connectionId}:${m.id}`

  const resetOne = async (m:any) => {
    try {
      await apiClient.deleteModelOverrides([{ connectionId: m.connectionId, rawId: m.rawId }])
      await fetchAll()
      toast({ title: '已重置', description: `${m.name || m.id} 的覆写配置已清除` })
    } catch (e: any) {
      toast({
        title: '重置失败',
        description: e?.message || '操作失败',
        variant: 'destructive',
      })
    }
  }

  const manualRefresh = async () => {
    setRefreshing(true)
    try {
      await apiClient.refreshModelCatalog()
      await fetchAll()
      toast({ title: '已获取最新模型列表' })
    } catch (err: any) {
      toast({
        title: '刷新失败',
        description: err?.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setRefreshing(false)
    }
  }

  const handleClearAll = async () => {
    if (clearing) return
    setClearing(true)
    try {
      await apiClient.deleteAllModelOverrides()
      await fetchAll()
      toast({ title: '已清除全部覆写' })
    } catch (err: any) {
      toast({
        title: '清除覆写失败',
        description: err?.message || String(err),
        variant: 'destructive',
      })
    } finally {
      setClearing(false)
      setClearDialogOpen(false)
    }
  }

  const handleImport = async (file: File) => {
    try {
      const txt = await file.text()
      const json = JSON.parse(txt)
      const items = Array.isArray(json?.items) ? json.items : []
      for (const it of items) {
        let tags = Array.isArray(it?.tags) ? it.tags : []
        if ((!tags || tags.length === 0) && it?.capabilities && typeof it.capabilities === 'object') {
          const caps = it.capabilities
          const capTags = CAP_KEYS.filter((k)=>Boolean(caps[k])).map((k)=>({ name: k }))
          tags = capTags
        }
        if (it?.connectionId && it?.rawId) {
          await apiClient.updateModelTags(Number(it.connectionId), String(it.rawId), tags)
        }
      }
      await fetchAll()
      toast({ title: '导入完成', description: `共应用 ${items.length} 项覆写。` })
    } catch (err:any) {
      toast({
        title: '导入失败',
        description: err?.message || String(err),
        variant: 'destructive',
      })
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleExport = () => {
    const src = (models||[]).filter((m:any)=> m.overridden)
    const items = src.map((m:any)=>({ connectionId: m.connectionId, rawId: m.rawId, tags: m.tags || [] }))
    const blob = new Blob([JSON.stringify({ items }, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'model-capabilities-overrides.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    toast({ title: '已导出覆写配置', description: `共导出 ${items.length} 项配置` })
  }

  // 批量选择逻辑
  const toggleSelectAll = () => {
    if (selectedKeys.size === list.length && list.length > 0) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(list.map((m:any) => keyOf(m))))
    }
  }

  const toggleSelectRow = (key: string) => {
    const newSet = new Set(selectedKeys)
    if (newSet.has(key)) {
      newSet.delete(key)
    } else {
      newSet.add(key)
    }
    setSelectedKeys(newSet)
  }

  // 批量重置
  const handleBatchReset = async () => {
    const selectedModels = list.filter((m:any) => selectedKeys.has(keyOf(m)))
    try {
      await Promise.all(selectedModels.map((m:any) =>
        apiClient.deleteModelOverrides([{ connectionId: m.connectionId, rawId: m.rawId }])
      ))
      await fetchAll()
      toast({ title: '批量重置成功', description: `已重置 ${selectedModels.length} 个模型的覆写配置` })
      setSelectedKeys(new Set())
    } catch (e: any) {
      toast({
        title: '批量重置失败',
        description: e?.message || '操作失败',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6 min-w-0">

      {/* 搜索筛选区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Cpu className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">模型管理</CardTitle>
            <CardDescription>为模型开启/关闭能力标签:图片理解、文件上传、联网搜索、图像生成、代码解释器</CardDescription>
          </div>
        </div>

        <Card className="px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="搜索模型/提供方..."
                  value={q}
                  onChange={(e)=>setQ(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded border bg-background">
                <Checkbox
                  id="only-overridden"
                  checked={onlyOverridden}
                  onChange={(e) => setOnlyOverridden(e.target.checked)}
                />
                <Label htmlFor="only-overridden" className="text-sm font-normal cursor-pointer">
                  仅显示已手动设置
                </Label>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <Button variant="outline" size="sm" onClick={()=>fetchAll()} disabled={isLoading} className="w-full sm:w-auto">
                <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
                重新加载
              </Button>
              <Button size="sm" onClick={manualRefresh} disabled={refreshing} className="w-full sm:w-auto">
                <RefreshCw className={`w-4 h-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? '刷新中…' : '手动获取最新'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="w-full sm:w-auto">
                    <MoreVertical className="w-4 h-4 mr-1" />
                    更多操作
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleExport}>
                    <Download className="w-4 h-4 mr-2" />
                    导出覆写配置
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={()=>fileInputRef.current?.click()}>
                    <Upload className="w-4 h-4 mr-2" />
                    导入覆写配置
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onSelect={()=>setClearDialogOpen(true)}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    清除全部覆写
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e)=>{
                  const file = e.target.files?.[0]
                  if (file) { handleImport(file) }
                }}
              />
            </div>
          </div>

          {/* 能力说明 */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-4 pt-4 border-t">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <span>已开启</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-muted border"></div>
              <span>未开启</span>
            </div>
            <div className="ml-auto text-xs">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 cursor-help">
                      <HelpCircle className="w-3 h-3" />
                      <span>小提示</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>开关仅影响前端可用功能;</p>
                    <p>若模型原生不支持,对应功能不会生效</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </Card>
      </div>

      {/* 批量操作栏 */}
      {selectedKeys.size > 0 && (
        <Card className="px-4 py-3 sm:px-5 sm:py-3 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-medium">
              已选择 {selectedKeys.size} 个模型
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
              <Button size="sm" variant="outline" onClick={handleBatchReset} disabled={isLoading}>
                <RotateCcw className="w-4 h-4 mr-1" />
                批量重置覆写
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedKeys(new Set())}>
                取消选择
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* 清除全部覆写确认对话框 */}
      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清除全部覆写?</AlertDialogTitle>
            <AlertDialogDescription>
              该操作将移除全部模型能力覆写配置,且无法撤销。请确认已备份所需规则。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAll} disabled={clearing} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {clearing ? '清除中…' : '确认清除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 模型列表区块 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">模型列表 ({list.length})</CardTitle>
        </div>

        <Card className="px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
          {isLoading && list.length===0 ? (
            // 骨架屏加载
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="w-8 h-8" />
                  <Skeleton className="h-8 flex-1" />
                  <Skeleton className="w-16 h-8" />
                  <Skeleton className="w-16 h-8" />
                  <Skeleton className="w-16 h-8" />
                  <Skeleton className="w-16 h-8" />
                  <Skeleton className="w-16 h-8" />
                </div>
              ))}
            </div>
          ) : !isLoading && list.length===0 ? (
            // 空状态
            <div className="text-center py-12">
              <Cpu className="w-16 h-16 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-sm text-muted-foreground mb-2">暂无模型数据</p>
              <p className="text-xs text-muted-foreground">
                {q || onlyOverridden ? '尝试调整搜索条件或筛选器' : '点击"手动获取最新"加载模型列表'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[680px]">
                <TableHeader className="sticky top-0 z-30 bg-muted/50">
                  <TableRow>
                    <TableHead className="w-12 text-center">
                      <Checkbox
                        checked={selectedKeys.size === list.length && list.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => toggleSort('name')}
                    >
                      模型 {sortField === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </TableHead>
                    {CAP_KEYS.map((k) => {
                      const Icon = CAP_ICONS[k]
                      return (
                        <TableHead key={k} className="text-center w-[52px]">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-center gap-1 cursor-help">
                                  <Icon className="w-4 h-4" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{CAP_LABELS[k]}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableHead>
                      )
                    })}
                    <TableHead className="text-center w-[60px]">手动</TableHead>
                    <TableHead className="text-center w-[70px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((m:any)=>{
                    const key = keyOf(m)
                    const isBusy = saving === key
                    return (
                      <TableRow key={key} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="text-center">
                          <Checkbox
                            checked={selectedKeys.has(key)}
                            onChange={() => toggleSelectRow(key)}
                          />
                        </TableCell>
                        <TableCell className="py-3 px-3">
                          <div className="font-medium break-words">{m.name || m.id}</div>
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-[11px] font-normal">
                              {recommendTag(m)}
                            </Badge>
                            {m.provider && (
                              <Badge variant="secondary" className="text-[10px] font-normal">
                                {m.provider}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {CAP_KEYS.map((k)=>{
                          const checked = has(m, k)
                          const sid = `${m.connectionId}-${m.id}-${k}`
                          return (
                            <TableCell key={k} className="py-3 px-3 text-center">
                              <Switch
                                id={sid}
                                className="scale-75 mx-auto"
                                checked={checked}
                                disabled={isBusy}
                                onCheckedChange={(v)=>{
                                  const newTags = onToggle(m, k, v);
                                  saveCaps(m, newTags)
                                }}
                                aria-label={`${CAP_LABELS[k]}开关`}
                              />
                            </TableCell>
                          )
                        })}
                        <TableCell className="py-3 px-3 text-center">
                          {m.overridden ? (
                            <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs">
                              是
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">否</span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-center">
                          {m.overridden ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={()=>resetOne(m)}
                              className="h-7 text-xs"
                              disabled={isBusy}
                            >
                              <RotateCcw className="w-3 h-3 mr-1" />
                              重置
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
