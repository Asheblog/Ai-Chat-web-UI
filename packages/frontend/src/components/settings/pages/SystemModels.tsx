"use client"
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useModelsStore } from '@/store/models-store'
import { apiClient } from '@/lib/api'
import { Cpu, MoreVertical } from 'lucide-react'

const CAP_KEYS = ['vision','file_upload','web_search','image_generation','code_interpreter'] as const
type CapKey = typeof CAP_KEYS[number]

// 显示用中文标签（仅影响 UI 文案，不改变接口键名）
const CAP_LABELS: Record<CapKey, string> = {
  vision: '图片理解（Vision）',
  file_upload: '文件上传',
  web_search: '联网搜索',
  image_generation: '图像生成',
  code_interpreter: '代码解释器',
}

export function SystemModelsPage() {
  const { models, isLoading, fetchAll } = useModelsStore()
  const [q, setQ] = useState('')
  const [onlyOverridden, setOnlyOverridden] = useState(false)
  const [saving, setSaving] = useState<string>('') // key `${cid}:${id}`
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    fetchAll().catch(() => {})
  }, [fetchAll])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (models || []).filter((m:any) => {
      if (!kw) return true
      return [m.id, m.rawId, m.name, m.provider].some((s)=>String(s||'').toLowerCase().includes(kw))
    }).filter((m:any)=> onlyOverridden ? m?.overridden : true)
  }, [models, q, onlyOverridden])

  const has = (m:any, k:CapKey) => Boolean(m?.capabilities?.[k])

  // 简单启发式：给出“推荐用途”标签（无后端字段时的友好占位）
  const recommendTag = (m:any): string | null => {
    const key = `${m?.id||''} ${m?.name||''} ${m?.rawId||''}`.toLowerCase()
    if (/reason|math|logic|deepseek-reasoner/.test(key)) return '推荐：推理/数学'
    if (/image-gen|image_generation|dall|sd|flux|kandinsky/.test(key)) return '推荐：图像生成'
    if (/vision|vl|4o|gpt-4o|omni|gpt-4v/.test(key)) return '推荐：多模态'
    if (/embed|embedding/.test(key)) return '推荐：嵌入/检索'
    return '推荐：通用对话'
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
    } finally { setSaving('') }
  }

  const keyOf = (m:any) => `${m.connectionId}:${m.id}`

  const resetOne = async (m:any) => {
    await apiClient.deleteModelOverrides([{ connectionId: m.connectionId, rawId: m.rawId }])
    await fetchAll()
  }

  const manualRefresh = async () => {
    setRefreshing(true)
    try {
      await apiClient.refreshModelCatalog()
      await fetchAll()
      alert('已获取最新模型列表')
    } catch (err: any) {
      alert('刷新失败：' + (err?.message || String(err)))
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-6">

      {/* 工具栏区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Cpu className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-lg font-semibold">搜索和筛选</h3>
            <p className="text-sm text-muted-foreground">为模型开启/关闭能力标签：图片理解、文件上传、联网搜索、图像生成、代码解释器</p>
          </div>
        </div>

        <div className="px-5 py-5 rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input className="w-full sm:w-64" placeholder="搜索模型/提供方..." value={q} onChange={(e)=>setQ(e.target.value)} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <label className="text-sm flex items-center gap-2 px-3 py-2 rounded border bg-background">
                <input type="checkbox" checked={onlyOverridden} onChange={(e)=>setOnlyOverridden(e.target.checked)} />
                仅显示已手动设置
              </label>
              <Button variant="outline" size="sm" onClick={()=>fetchAll()} className="w-full sm:w-auto">重新加载</Button>
              <Button size="sm" onClick={manualRefresh} disabled={refreshing} className="w-full sm:w-auto">
                {refreshing ? '刷新中…' : '手动获取最新'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="w-full sm:w-auto">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={async ()=>{
                    const src = (models||[]).filter((m:any)=> m.overridden)
                    const items = src.map((m:any)=>({ connectionId: m.connectionId, rawId: m.rawId, tags: m.tags || [] }))
                    const blob = new Blob([JSON.stringify({ items }, null, 2)], { type: 'application/json;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = 'model-capabilities-overrides.json';
                    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
                  }}>导出覆写</DropdownMenuItem>
                  <DropdownMenuItem onClick={()=>document.getElementById('import-cap-file')?.click() as any}>导入覆写</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={async ()=>{
                    if (!confirm('确定要清除全部覆写吗？此操作不可撤销。')) return
                    await apiClient.deleteAllModelOverrides(); await fetchAll()
                  }}>清除全部覆写</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <input type="file" accept="application/json" className="hidden" id="import-cap-file" onChange={async (e)=>{
                const f = e.target.files?.[0]; if (!f) return
                try {
                  const txt = await f.text(); const json = JSON.parse(txt)
                  const items = Array.isArray(json?.items) ? json.items : []
                  for (const it of items) {
                    let tags = Array.isArray(it?.tags) ? it.tags : []
                    if ((!tags || tags.length===0) && it?.capabilities && typeof it.capabilities === 'object') {
                      const caps = it.capabilities
                      const capTags = CAP_KEYS.filter((k)=>Boolean(caps[k])).map((k)=>({ name: k }))
                      tags = capTags
                    }
                    if (it?.connectionId && it?.rawId) {
                      await apiClient.updateModelTags(Number(it.connectionId), String(it.rawId), tags)
                    }
                  }
                  await fetchAll(); alert('导入完成')
                } catch (err:any) { alert('导入失败: ' + (err?.message||String(err))) }
                finally { (e.target as HTMLInputElement).value = '' }
              }} />
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-4 pt-4 border-t">
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-emerald-500"></i>已开启</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-muted border"></i>未开启</span>
            <span className="ml-auto">小提示：开关仅影响前端可用功能；若模型原生不支持，对应功能不会生效</span>
          </div>
        </div>
      </div>

      {/* 模型列表区块 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">模型列表 ({list.length})</h3>
        </div>

        {isLoading && list.length===0 && (<div className="text-sm text-muted-foreground text-center py-6">加载中...</div>)}
        {!isLoading && list.length===0 && (<div className="text-sm text-muted-foreground text-center py-6">暂无模型</div>)}

        <div className="overflow-x-auto rounded-lg border border-border">
          <Table className="min-w-[720px] table-fixed">
            <TableHeader className="sticky top-0 z-30 bg-muted/50 shadow-sm">
              <TableRow>
                <TableHead className="sticky top-0 z-30 w-[32%] h-10 bg-muted/50">模型</TableHead>
                <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-muted/50">图片</TableHead>
                <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-muted/50">上传</TableHead>
              <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-muted/50">联网</TableHead>
              <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-muted/50">生图</TableHead>
              <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-muted/50">解释器</TableHead>
              <TableHead className="sticky top-0 z-30 text-center w-[8%] text-xs h-10 bg-muted/50 whitespace-nowrap">手动</TableHead>
              <TableHead className="sticky top-0 z-30 text-right w-[8%] text-xs h-10 bg-muted/50 whitespace-nowrap">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((m:any)=>{
              return (
                <TableRow key={`${m.connectionId}:${m.id}`} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="py-3 px-3 w-[32%]">
                    <div className="font-medium whitespace-normal break-words">{m.name || m.id}</div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[11px] font-normal">{recommendTag(m)}</Badge>
                    </div>
                  </TableCell>
                  {CAP_KEYS.map((k)=>{
                    const checked = has(m, k)
                    const sid = `${m.connectionId}-${m.id}-${k}`
                    return (
                      <TableCell key={k} className="py-3 px-3 align-middle text-center w-[10%]">
                        <Switch id={sid} className="scale-75 mx-auto" defaultChecked={checked} disabled={saving===`${m.connectionId}:${m.id}`}
                          onCheckedChange={(v)=>{ const newTags = onToggle(m, k, v); saveCaps(m, newTags) }}
                          aria-label={`${CAP_LABELS[k]}开关`} />
                      </TableCell>
                    )
                  })}
                  <TableCell className="py-3 px-3 text-center text-xs w-[8%] whitespace-nowrap">
                    {m.overridden ? <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">是</Badge> : '否'}
                  </TableCell>
                  <TableCell className="py-3 px-3 text-right text-xs w-[8%] whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={()=>resetOne(m)} className="h-7 text-xs">重置</Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
