"use client"
import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function SystemConnectionsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState<any>({ provider: 'openai', baseUrl: '', authType: 'bearer', apiKey: '', azureApiVersion: '', enable: true, prefixId: '', tags: '', modelIds: '', connectionType: 'external' })
  const [cap, setCap] = useState<{ vision: boolean; file_upload: boolean; web_search: boolean; image_generation: boolean; code_interpreter: boolean }>({ vision: false, file_upload: false, web_search: false, image_generation: false, code_interpreter: false })

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiClient.getSystemConnections()
      setRows(res?.data || [])
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => { setForm({ provider: 'openai', baseUrl: '', authType: 'bearer', apiKey: '', azureApiVersion: '', enable: true, prefixId: '', tags: '', modelIds: '', connectionType: 'external' }); setCap({ vision: false, file_upload: false, web_search: false, image_generation: false, code_interpreter: false }) }

  const onEdit = (row: any) => {
    setEditing(row)
    setForm({
      provider: row.provider,
      baseUrl: row.baseUrl,
      authType: row.authType,
      apiKey: '',
      azureApiVersion: row.azureApiVersion || '',
      enable: !!row.enable,
      prefixId: row.prefixId || '',
      tags: (() => { try { return (JSON.parse(row.tagsJson||'[]')||[]).map((t:any)=>t.name).filter((n:string)=>!['vision','file_upload','web_search','image_generation','code_interpreter'].includes(n)).join(',') } catch { return '' } })(),
      modelIds: (() => { try { return (JSON.parse(row.modelIdsJson||'[]')||[]).join(',') } catch { return '' } })(),
      connectionType: row.connectionType || 'external',
    })
    try {
      const arr = JSON.parse(row.tagsJson||'[]') || []
      const names = new Set(arr.map((t:any)=>String(t?.name||'')))
      setCap({
        vision: names.has('vision'),
        file_upload: names.has('file_upload'),
        web_search: names.has('web_search'),
        image_generation: names.has('image_generation'),
        code_interpreter: names.has('code_interpreter'),
      })
    } catch { setCap({ vision:false, file_upload:false, web_search:false, image_generation:false, code_interpreter:false }) }
  }

  const onDelete = async (id: number) => {
    await apiClient.deleteSystemConnection(id)
    await load()
  }

  const buildTags = () => {
    const free = form.tags ? form.tags.split(',').map((s:string)=>({name:s.trim()})).filter((s:any)=>s.name && !['vision','file_upload','web_search','image_generation','code_interpreter'].includes(s.name)) : []
    const caps = Object.entries(cap).filter(([,v])=>v).map(([k])=>({ name: k }))
    return [...free, ...caps]
  }

  const onVerify = async () => {
    const payload = {
      provider: form.provider,
      baseUrl: form.baseUrl,
      authType: form.authType,
      apiKey: form.apiKey || undefined,
      azureApiVersion: form.azureApiVersion || undefined,
      enable: !!form.enable,
      prefixId: form.prefixId || undefined,
      tags: buildTags(),
      modelIds: form.modelIds ? form.modelIds.split(',').map((s:string)=>s.trim()).filter(Boolean) : [],
      connectionType: form.connectionType,
    }
    await apiClient.verifySystemConnection(payload)
    alert('验证成功')
  }

  const onSubmit = async () => {
    const payload = {
      provider: form.provider,
      baseUrl: form.baseUrl,
      authType: form.authType,
      apiKey: form.apiKey || undefined,
      azureApiVersion: form.azureApiVersion || undefined,
      enable: !!form.enable,
      prefixId: form.prefixId || undefined,
      tags: buildTags(),
      modelIds: form.modelIds ? form.modelIds.split(',').map((s:string)=>s.trim()).filter(Boolean) : [],
      connectionType: form.connectionType,
    }
    if (editing) await apiClient.updateSystemConnection(editing.id, payload)
    else await apiClient.createSystemConnection(payload)
    setEditing(null)
    resetForm()
    await load()
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-base font-medium">连接管理（系统）</div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="w-full sm:w-auto">刷新</Button>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="space-y-3 bg-muted/30 p-3 rounded">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Provider</Label>
            <Select value={form.provider} onValueChange={(v)=>setForm((f:any)=>({...f, provider:v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Auth</Label>
            <Select value={form.authType} onValueChange={(v)=>setForm((f:any)=>({...f, authType:v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="bearer">Bearer</SelectItem>
                <SelectItem value="session">Session</SelectItem>
                <SelectItem value="system_oauth">System OAuth</SelectItem>
                <SelectItem value="microsoft_entra_id">Entra ID</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-1 sm:col-span-2">
            <Label>Base URL</Label>
            <Input value={form.baseUrl} onChange={(e)=>setForm((f:any)=>({...f, baseUrl:e.target.value }))} placeholder="https://api.openai.com/v1" />
          </div>
          {form.authType==='bearer' && (
            <div className="col-span-1 sm:col-span-2">
              <Label>API Key</Label>
              <Input type="password" value={form.apiKey} onChange={(e)=>setForm((f:any)=>({...f, apiKey:e.target.value }))} placeholder="sk-..." />
            </div>
          )}
          {form.provider==='azure_openai' && (
            <div>
              <Label>API Version</Label>
              <Input value={form.azureApiVersion} onChange={(e)=>setForm((f:any)=>({...f, azureApiVersion:e.target.value }))} placeholder="2024-02-15-preview" />
            </div>
          )}
          <div>
            <Label>Prefix ID</Label>
            <Input value={form.prefixId} onChange={(e)=>setForm((f:any)=>({...f, prefixId:e.target.value }))} placeholder="可选：前缀，避免冲突" />
          </div>
          <div>
            <Label>Connection Type</Label>
            <Select value={form.connectionType} onValueChange={(v)=>setForm((f:any)=>({...f, connectionType:v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="external">external</SelectItem>
                <SelectItem value="local">local</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-1 sm:col-span-2">
            <Label>Tags（逗号分隔）</Label>
            <Input value={form.tags} onChange={(e)=>setForm((f:any)=>({...f, tags:e.target.value }))} placeholder="prod,team-a" />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <Label>能力标签（勾选即添加 vision/file_upload 等标签）</Label>
            <div className="flex flex-wrap gap-3 text-sm mt-1">
              {['vision','file_upload','web_search','image_generation','code_interpreter'].map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="checkbox" checked={(cap as any)[k]} onChange={(e)=>setCap((c:any)=>({ ...c, [k]: e.target.checked }))} />
                  <span>{k}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="col-span-1 sm:col-span-2">
            <Label>Model IDs（逗号分隔，留空自动枚举）</Label>
            <Input value={form.modelIds} onChange={(e)=>setForm((f:any)=>({...f, modelIds:e.target.value }))} placeholder="gpt-4o, gpt-4o-mini" />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onSubmit} disabled={loading} className="w-full sm:w-auto">{editing? '保存' : '新增'}</Button>
          <Button onClick={onVerify} variant="outline" disabled={loading} className="w-full sm:w-auto">验证连接</Button>
          {editing && <Button onClick={()=>{ setEditing(null); resetForm() }} variant="ghost" className="w-full sm:w-auto">取消编辑</Button>}
        </div>
      </div>
      <div className="space-y-2">
        {/* 骨架屏 */}
        {loading && rows.length === 0 && (
          <>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-3 border rounded">
                <div className="h-4 w-52 bg-muted rounded" />
                <div className="mt-2 h-3 w-64 bg-muted/70 rounded" />
              </div>
            ))}
          </>
        )}

        {/* 空态 */}
        {!loading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6">暂无连接，填写上方表单后新增</div>
        )}

        {rows.map((r:any) => (
          <div key={r.id} className="p-3 border rounded flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="font-medium">[{r.provider}] {r.baseUrl}</div>
              <div className="text-xs text-muted-foreground">auth={r.authType} prefix={r.prefixId||'-'} type={r.connectionType}</div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button size="sm" variant="outline" onClick={()=>onEdit(r)} className="w-full sm:w-auto">编辑</Button>
              <Button size="sm" variant="destructive" onClick={()=>onDelete(r.id)} className="w-full sm:w-auto">删除</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
