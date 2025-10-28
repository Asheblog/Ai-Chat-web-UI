"use client"
import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api'
import { deriveChannelName } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function UserConnectionsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState<any>({ provider: 'openai', baseUrl: '', authType: 'bearer', apiKey: '', azureApiVersion: '', enable: true, prefixId: '', tags: '', modelIds: '', connectionType: 'external' })

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiClient.getUserConnections()
      setRows(res?.data || [])
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => setForm({ provider: 'openai', baseUrl: '', authType: 'bearer', apiKey: '', azureApiVersion: '', enable: true, prefixId: '', tags: '', modelIds: '', connectionType: 'external' })

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
      tags: (() => { try { return (JSON.parse(row.tagsJson||'[]')||[]).map((t:any)=>t.name).join(',') } catch { return '' } })(),
      modelIds: (() => { try { return (JSON.parse(row.modelIdsJson||'[]')||[]).join(',') } catch { return '' } })(),
      connectionType: row.connectionType || 'external',
    })
  }

  const onDelete = async (id: number) => {
    await apiClient.deleteUserConnection(id)
    await load()
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
      tags: form.tags ? form.tags.split(',').map((s:string)=>({name:s.trim()})).filter((s:any)=>s.name) : [],
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
      tags: form.tags ? form.tags.split(',').map((s:string)=>({name:s.trim()})).filter((s:any)=>s.name) : [],
      modelIds: form.modelIds ? form.modelIds.split(',').map((s:string)=>s.trim()).filter(Boolean) : [],
      connectionType: form.connectionType,
    }
    if (editing) await apiClient.updateUserConnection(editing.id, payload)
    else await apiClient.createUserConnection(payload)
    setEditing(null)
    resetForm()
    await load()
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-base font-medium">直连连接（个人）</div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>刷新</Button>
      </div>
      {error && <div className="text-sm text-destructive">{error}</div>}
      <div className="space-y-3 bg-muted/30 p-3 rounded">
        <div className="grid grid-cols-2 gap-3">
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
          <div className="col-span-2">
            <Label>Base URL</Label>
            <Input value={form.baseUrl} onChange={(e)=>setForm((f:any)=>({...f, baseUrl:e.target.value }))} placeholder="https://api.openai.com/v1" />
          </div>
          {form.authType==='bearer' && (
            <div className="col-span-2">
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
          <div className="col-span-2">
            <Label>Tags（逗号分隔）</Label>
            <Input value={form.tags} onChange={(e)=>setForm((f:any)=>({...f, tags:e.target.value }))} placeholder="dev,my" />
          </div>
          <div className="col-span-2">
            <Label>Model IDs（逗号分隔，留空自动枚举）</Label>
            <Input value={form.modelIds} onChange={(e)=>setForm((f:any)=>({...f, modelIds:e.target.value }))} placeholder="gpt-4o, gpt-4o-mini" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={onSubmit} disabled={loading}>{editing? '保存' : '新增'}</Button>
          <Button onClick={onVerify} variant="outline" disabled={loading}>验证连接</Button>
          {editing && <Button onClick={()=>{ setEditing(null); resetForm() }} variant="ghost">取消编辑</Button>}
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((r:any) => {
          const channelLabel = deriveChannelName(r.provider, r.baseUrl)
          return (
            <div key={r.id} className="p-3 border rounded flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="font-medium">渠道商 | {channelLabel}</div>
                <div className="text-xs text-muted-foreground break-all">{r.baseUrl}</div>
                <div className="text-xs text-muted-foreground">provider={r.provider} auth={r.authType} prefix={r.prefixId||'-'} type={r.connectionType}</div>
              </div>
              <div className="flex gap-2 sm:flex-row">
                <Button size="sm" variant="outline" onClick={()=>onEdit(r)} className="w-full sm:w-auto">编辑</Button>
                <Button size="sm" variant="destructive" onClick={()=>onDelete(r.id)} className="w-full sm:w-auto">删除</Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
