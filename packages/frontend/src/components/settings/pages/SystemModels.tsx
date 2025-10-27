"use client"
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
// （移除未使用的 Label 导入）
import { useModelsStore } from '@/store/models-store'
import { apiClient } from '@/lib/api'

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

  useEffect(() => { fetchAll().catch(()=>{}) }, [])

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

  return (
    <div className="space-y-3 p-4">
      {/* 顶部：标题 + 工具条 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-base font-medium">模型管理（能力标签）</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Input className="w-full sm:w-64" placeholder="搜索模型/提供方..." value={q} onChange={(e)=>setQ(e.target.value)} />
          <label className="text-sm flex items-center gap-1">
            <input type="checkbox" checked={onlyOverridden} onChange={(e)=>setOnlyOverridden(e.target.checked)} />
            仅显示已手动设置
          </label>
          <Button variant="outline" size="sm" onClick={()=>fetchAll()} className="w-full sm:w-auto">刷新</Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">为模型开启/关闭能力：图片理解、文件上传、联网搜索、图像生成、代码解释器。若不确定，可点击卡片右下角“重置为自动识别”。</div>

      {/* 精简：保留“更多”菜单以收纳导入/导出/清空等操作 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">小提示：开关仅影响前端可用功能；若模型原生不支持，对应功能不会生效。</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="w-full sm:w-auto">更多</Button>
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

      {/* 状态图例（精简版） */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-emerald-500"></i>已开启</span>
        <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-muted border"></i>未开启</span>
      </div>

      {/* 列表区域 */}
      <div className="space-y-2">
        {isLoading && list.length===0 && (<div className="text-sm text-muted-foreground">加载中...</div>)}
        {!isLoading && list.length===0 && (<div className="text-sm text-muted-foreground">暂无模型</div>)}

        <div className="overflow-x-auto">
          <Table className="min-w-[720px] table-fixed">
            <TableHeader className="sticky top-0 z-30 bg-background shadow-sm">
              <TableRow>
                <TableHead className="sticky top-0 z-30 w-[32%] h-10 bg-background">模型</TableHead>
                <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-background">图片</TableHead>
                <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-background">上传</TableHead>
              <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-background">联网</TableHead>
              <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-background">生图</TableHead>
              <TableHead className="sticky top-0 z-30 text-center w-[10%] text-xs h-10 bg-background">解释器</TableHead>
              <TableHead className="sticky top-0 z-30 text-center w-[8%] text-xs h-10 bg-background whitespace-nowrap">手动</TableHead>
              <TableHead className="sticky top-0 z-30 text-right w-[8%] text-xs h-10 bg-background whitespace-nowrap">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((m:any)=>{
              return (
                <TableRow key={`${m.connectionId}:${m.id}`}>
                  <TableCell className="py-2 px-3 w-[32%]">
                    <div className="font-medium whitespace-normal break-words">{m.name || m.id}</div>
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] px-2 py-0.5 rounded-full border bg-muted/30 text-muted-foreground">{recommendTag(m)}</span>
                    </div>
                  </TableCell>
                  {CAP_KEYS.map((k)=>{
                    const checked = has(m, k)
                    const sid = `${m.connectionId}-${m.id}-${k}`
                    return (
                      <TableCell key={k} className="py-2 px-3 align-middle text-center w-[10%]">
                        <Switch id={sid} className="scale-75 mx-auto" defaultChecked={checked} disabled={saving===`${m.connectionId}:${m.id}`}
                          onCheckedChange={(v)=>{ const newTags = onToggle(m, k, v); saveCaps(m, newTags) }}
                          aria-label={`${CAP_LABELS[k]}开关`} />
                      </TableCell>
                    )
                  })}
                  <TableCell className="py-2 px-3 text-center text-xs w-[8%] whitespace-nowrap">{m.overridden ? <span className="px-2 py-0.5 rounded-full border border-purple-400 text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-300">是</span> : '否'}</TableCell>
                  <TableCell className="py-2 px-3 text-right text-xs w-[8%] whitespace-nowrap">
                    <button className="text-primary" onClick={()=>resetOne(m)}>重置</button>
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
