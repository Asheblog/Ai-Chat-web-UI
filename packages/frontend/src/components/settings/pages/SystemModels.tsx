"use client"
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardTitle, CardDescription } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { useSystemModels } from '@/components/settings/system-models/use-system-models'
import { MODEL_CAP_KEYS, MODEL_CAP_LABELS, MODEL_CAP_ICONS, MODEL_CAP_SOURCE_LABELS } from '@/components/settings/system-models/constants'
import {
  Cpu,
  MoreVertical,
  RefreshCw,
  Search,
  Download,
  Upload,
  Trash2,
  RotateCcw,
  HelpCircle
} from 'lucide-react'

const modelKey = (model: any) => `${model.connectionId}:${model.id}`

export function SystemModelsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const {
    list,
    isLoading,
    q,
    setQ,
    onlyOverridden,
    setOnlyOverridden,
    sortField,
    sortOrder,
    toggleSort,
    selectedKeys,
    toggleSelectAll,
    toggleSelectRow,
    clearSelection,
    savingKey,
    refreshing,
    manualRefresh,
    reload,
    clearDialogOpen,
    setClearDialogOpen,
    clearing,
    handleClearAll,
    handleExport,
    handleImportFile,
    handleToggleCapability,
    handleSaveMaxTokens,
    handleUpdateAccessPolicy,
    resetModel,
    handleBatchReset,
    hasCapability,
    recommendTag,
    accessOptions,
  } = useSystemModels()
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false)
  const [tokenDialogModel, setTokenDialogModel] = useState<any | null>(null)
  const [tokenDialogValue, setTokenDialogValue] = useState('')

  const openTokenDialog = (model: any) => {
    setTokenDialogModel(model)
    setTokenDialogValue(typeof model.maxOutputTokens === 'number' ? String(model.maxOutputTokens) : '')
    setTokenDialogOpen(true)
  }

  const closeTokenDialog = () => {
    setTokenDialogOpen(false)
    setTokenDialogModel(null)
    setTokenDialogValue('')
  }

  const dialogSaving = tokenDialogModel ? savingKey === modelKey(tokenDialogModel) : false

  const handleTokenDialogSave = async () => {
    if (!tokenDialogModel) return
    await handleSaveMaxTokens(tokenDialogModel, tokenDialogValue)
    closeTokenDialog()
  }
  return (
    <>
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
                  onCheckedChange={(checked) => setOnlyOverridden(Boolean(checked))}
                />
                <Label htmlFor="only-overridden" className="text-sm font-normal cursor-pointer">
                  仅显示已手动设置
                </Label>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <Button variant="outline" size="sm" onClick={reload} disabled={isLoading} className="w-full sm:w-auto">
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
                onChange={async (e)=>{
                  const file = e.target.files?.[0]
                  if (file) {
                    await handleImportFile(file)
                    e.target.value = ''
                  }
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
              <Button size="sm" variant="ghost" onClick={clearSelection}>
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
              <Table className="w-full table-fixed">
                <TableHeader className="sticky top-0 z-30 bg-muted/50">
                  <TableRow>
                    <TableHead className="w-12 text-center">
                      <Checkbox
                        checked={selectedKeys.size === list.length && list.length > 0}
                        onCheckedChange={() => toggleSelectAll()}
                      />
                    </TableHead>
                    <TableHead
                      className="w-[200px] cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => toggleSort('name')}
                    >
                      模型 {sortField === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                    </TableHead>
                    {MODEL_CAP_KEYS.map((k) => {
                      const Icon = MODEL_CAP_ICONS[k]
                      return (
                        <TableHead key={k} className="text-center w-[48px]">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-center gap-1 cursor-help">
                                  <Icon className="w-4 h-4" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{MODEL_CAP_LABELS[k]}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableHead>
                      )
                    })}
                    <TableHead className="text-center w-[110px]">匿名访问</TableHead>
                    <TableHead className="text-center w-[110px]">注册用户</TableHead>
                    <TableHead className="text-center w-[56px]">手动</TableHead>
                    <TableHead className="text-center w-[64px]">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((m:any)=>{
                    const key = modelKey(m)
                    const isBusy = savingKey === key
                    return (
                      <TableRow key={key} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="text-center">
                          <Checkbox
                            checked={selectedKeys.has(key)}
                            onCheckedChange={() => toggleSelectRow(key)}
                          />
                        </TableCell>
                        <TableCell className="py-3 px-3">
                          <div className="font-medium whitespace-normal break-words">{m.name || m.id}</div>
                          <div className="mt-1 flex items-center gap-2 flex-wrap text-xs">
                            <Badge variant="outline" className="text-[11px] font-normal">
                              {recommendTag(m)}
                            </Badge>
                            {m.provider && (
                              <Badge variant="secondary" className="text-[10px] font-normal">
                                {m.provider}
                              </Badge>
                            )}
                            {m.capabilitySource && (
                              <Badge variant="secondary" className="text-[10px] font-normal bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                                {MODEL_CAP_SOURCE_LABELS[m.capabilitySource] || `来源:${m.capabilitySource}`}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {MODEL_CAP_KEYS.map((k)=>{
                          const checked = hasCapability(m, k)
                          const sid = `${m.connectionId}-${m.id}-${k}`
                          return (
                            <TableCell key={k} className="py-3 px-3 text-center">
                          <Switch
                            id={sid}
                            className="scale-75 mx-auto"
                            checked={checked}
                            disabled={isBusy}
                            onCheckedChange={(v)=> handleToggleCapability(m, k, Boolean(v))}
                            aria-label={`${MODEL_CAP_LABELS[k]}开关`}
                          />
                            </TableCell>
                          )
                        })}
                        <TableCell className="py-3 px-3 text-center">
                          <Select
                            value={(m.accessPolicy?.anonymous as any) || 'inherit'}
                            onValueChange={(v) => handleUpdateAccessPolicy(m, 'anonymous', v as any)}
                            disabled={isBusy}
                          >
                            <SelectTrigger className="w-[108px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {accessOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            当前：{m.resolvedAccess?.anonymous?.decision === 'deny' ? '禁止' : '允许'}
                          </div>
                        </TableCell>
                        <TableCell className="py-3 px-3 text-center">
                          <Select
                            value={(m.accessPolicy?.user as any) || 'inherit'}
                            onValueChange={(v) => handleUpdateAccessPolicy(m, 'user', v as any)}
                            disabled={isBusy}
                          >
                            <SelectTrigger className="w-[108px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {accessOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            当前：{m.resolvedAccess?.user?.decision === 'deny' ? '禁止' : '允许'}
                          </div>
                        </TableCell>
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
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full"
                              >
                                <MoreVertical className="w-4 h-4" />
                                <span className="sr-only">更多操作</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={()=>openTokenDialog(m)}>
                                修改生成 Tokens
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={!m.overridden || isBusy}
                                onClick={()=>resetModel(m)}
                              >
                                重置覆写
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      <Dialog
        open={tokenDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (dialogSaving) return
            closeTokenDialog()
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>修改生成 Tokens</DialogTitle>
            <DialogDescription>
              {tokenDialogModel?.name || tokenDialogModel?.id || '未选择模型'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="number"
              min={1}
              max={256000}
              placeholder="32000"
              value={tokenDialogValue}
              onChange={(e)=>setTokenDialogValue(e.target.value)}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={dialogSaving}
            />
            <p className="text-sm text-muted-foreground">留空表示恢复供应商默认（通常 32K）。允许 1~256000。</p>
          </div>
          <DialogFooter className="pt-4">
            <Button
              variant="outline"
              onClick={closeTokenDialog}
              disabled={dialogSaving}
            >
              取消
            </Button>
            <Button onClick={handleTokenDialogSave} disabled={dialogSaving}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
