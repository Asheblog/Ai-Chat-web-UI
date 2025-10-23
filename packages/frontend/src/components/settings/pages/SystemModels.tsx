"use client"
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useModelsStore } from '@/store/models-store'
import { apiClient } from '@/lib/api'

const CAP_KEYS = ['vision','file_upload','web_search','image_generation','code_interpreter'] as const
type CapKey = typeof CAP_KEYS[number]

export function SystemModelsPage() {
  const { models, isLoading, fetchAll } = useModelsStore()
  const [q, setQ] = useState('')
  const [onlyOverridden, setOnlyOverridden] = useState(false)
  const [onlyVision, setOnlyVision] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({}) // key: `${cid}:${id}`
  const [batchCap, setBatchCap] = useState<CapKey>('vision')
  const [saving, setSaving] = useState<string>('') // key `${cid}:${id}`

  useEffect(() => { fetchAll().catch(()=>{}) }, [])

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (models || []).filter((m:any) => {
      if (!kw) return true
      return [m.id, m.rawId, m.name, m.provider].some((s)=>String(s||'').toLowerCase().includes(kw))
    }).filter((m:any)=> onlyOverridden ? m?.overridden : true)
      .filter((m:any)=> onlyVision ? Boolean(m?.capabilities?.vision) : true)
  }, [models, q, onlyOverridden, onlyVision])

  const has = (m:any, k:CapKey) => Boolean(m?.capabilities?.[k])

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
  const toggleSelectAll = () => {
    if (list.every((m)=>selected[keyOf(m)])) {
      setSelected({})
    } else {
      const n: Record<string, boolean> = {}
      list.forEach((m)=>{ n[keyOf(m)] = true })
      setSelected(n)
    }
  }

  const batchApply = async (value: boolean) => {
    const targets = list.filter((m)=>selected[keyOf(m)])
    for (const m of targets) {
      const newTags = onToggle(m, batchCap, value)
      await saveCaps(m, newTags)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-base font-medium">模型管理（能力标签）</div>
        <div className="flex items-center gap-2">
          <Input className="w-64" placeholder="搜索模型..." value={q} onChange={(e)=>setQ(e.target.value)} />
          <label className="text-sm flex items-center gap-1">
            <input type="checkbox" checked={onlyOverridden} onChange={(e)=>setOnlyOverridden(e.target.checked)} />
            仅显示有覆写的模型
          </label>
          <label className="text-sm flex items-center gap-1">
            <input type="checkbox" checked={onlyVision} onChange={(e)=>setOnlyVision(e.target.checked)} />
            仅显示能力=vision 的模型
          </label>
          <Button variant="outline" size="sm" onClick={()=>fetchAll()}>刷新</Button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground">为模型设置 vision / file_upload / web_search 等标签，后端将据此计算 capabilities，前端据此门控功能。</div>

      <div className="space-y-2">
        {isLoading && list.length===0 && (
          <div className="text-sm text-muted-foreground">加载中...</div>
        )}
        {!isLoading && list.length===0 && (
          <div className="text-sm text-muted-foreground">暂无模型</div>
        )}
        {/* 批量工具条 */}
        {list.length>0 && (
          <div className="p-2 border rounded flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={toggleSelectAll}>全选/取消全选</Button>
            <div className="text-sm">批量能力：</div>
            <select className="border rounded px-2 py-1 text-sm" value={batchCap} onChange={(e)=>setBatchCap(e.target.value as CapKey)}>
              {CAP_KEYS.map((k)=>(<option key={k} value={k}>{k}</option>))}
            </select>
            <Button size="sm" onClick={()=>batchApply(true)} disabled={saving!==''}>开启</Button>
            <Button size="sm" variant="secondary" onClick={()=>batchApply(false)} disabled={saving!==''}>关闭</Button>
            <div className="mx-2 w-px h-4 bg-muted" />
            <Button size="sm" variant="destructive" onClick={async ()=>{
              const items = list.filter((m)=>selected[keyOf(m)]).map((m)=>({ connectionId: m.connectionId, rawId: m.rawId }))
              if (items.length === 0) return
              await apiClient.deleteModelOverrides(items)
              await fetchAll()
              setSelected({})
            }} disabled={saving!==''}>批量清除覆写</Button>
            <Button size="sm" variant="outline" onClick={async ()=>{
              if (!confirm('确定要清除全部覆写吗？此操作不可撤销。')) return
              await apiClient.deleteAllModelOverrides()
              await fetchAll()
            }}>清除全部覆写</Button>
            <div className="mx-2 w-px h-4 bg-muted" />
            <Button size="sm" variant="outline" onClick={async ()=>{
              // 导出：若有选中导出选中，否则导出所有覆写
              const src = (models||[]).filter((m:any)=> m.overridden)
              const subset = Object.values(selected).some(Boolean) ? src.filter((m:any)=>selected[keyOf(m)]) : src
              const items = subset.map((m:any)=>({ connectionId: m.connectionId, rawId: m.rawId, tags: m.tags || [] }))
              const blob = new Blob([JSON.stringify({ items }, null, 2)], { type: 'application/json;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'model-capabilities-overrides.json'
              document.body.appendChild(a)
              a.click(); a.remove(); URL.revokeObjectURL(url)
            }}>导出覆写</Button>
            <label className="text-sm">
              <input type="file" accept="application/json" className="hidden" id="import-cap-file" onChange={async (e)=>{
                const f = e.target.files?.[0]; if (!f) return
                try {
                  const txt = await f.text()
                  const json = JSON.parse(txt)
                  const items = Array.isArray(json?.items) ? json.items : []
                  for (const it of items) {
                    // 支持 tags 或 capabilities 两种导入格式
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
                  await fetchAll()
                  alert('导入完成')
                } catch (err:any) {
                  alert('导入失败: ' + (err?.message||String(err)))
                } finally { (e.target as HTMLInputElement).value = '' }
              }} />
              <Button size="sm" className="ml-1" onClick={()=>document.getElementById('import-cap-file')?.click() as any}>导入覆写</Button>
            </label>
          </div>
        )}

        {list.map((m:any)=>{
          return (
            <div key={`${m.connectionId}:${m.id}`} className="p-3 border rounded">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">[{m.provider}] {m.name || m.id}</div>
                  <div className="text-xs text-muted-foreground">id={m.id} raw={m.rawId} conn={m.connectionId}</div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm flex items-center gap-1 mr-2">
                    <input type="checkbox" checked={!!selected[keyOf(m)]} onChange={(e)=>setSelected((s)=>({ ...s, [keyOf(m)]: e.target.checked }))} />
                    选中
                  </label>
                  {CAP_KEYS.map((k)=>{
                    const checked = has(m, k)
                    return (
                      <label key={k} className="text-sm flex items-center gap-1">
                        <input type="checkbox" defaultChecked={checked} onChange={(e)=>{
                          const newTags = onToggle(m, k, e.target.checked)
                          saveCaps(m, newTags)
                        }} disabled={saving===`${m.connectionId}:${m.id}`} />
                        <span>{k}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
