"use client"
import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api'
import { deriveChannelName } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import { Link2, Edit, Trash2 } from 'lucide-react'

const CAP_KEYS = ['vision','file_upload','web_search','image_generation','code_interpreter'] as const
type CapKey = typeof CAP_KEYS[number]
const CAP_LABELS: Record<CapKey, string> = {
  vision: '图片理解（Vision）',
  file_upload: '文件上传',
  web_search: '联网搜索',
  image_generation: '图像生成',
  code_interpreter: '代码解释器',
}

const createEmptyCaps = (): Record<CapKey, boolean> => ({
  vision: false,
  file_upload: false,
  web_search: false,
  image_generation: false,
  code_interpreter: false,
})

export function SystemConnectionsPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState<any>({ provider: 'openai', baseUrl: '', authType: 'bearer', apiKey: '', azureApiVersion: '', enable: true, prefixId: '', tags: '', modelIds: '', connectionType: 'external' })
  const [cap, setCap] = useState<Record<CapKey, boolean>>(createEmptyCaps)
  const { toast } = useToast()

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

  const resetForm = () => {
    setForm({
      provider: 'openai',
      baseUrl: '',
      authType: 'bearer',
      apiKey: '',
      azureApiVersion: '',
      enable: true,
      prefixId: '',
      tags: '',
      modelIds: '',
      connectionType: 'external',
    })
    setCap(createEmptyCaps())
  }

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
      setCap(() => {
        const next = createEmptyCaps()
        CAP_KEYS.forEach((key)=>{ next[key] = names.has(key) })
        return next
      })
    } catch { setCap(createEmptyCaps()) }
  }

  const onDelete = async (id: number) => {
    try {
      await apiClient.deleteSystemConnection(id)
      toast({ title: '已删除连接' })
      await load()
    } catch (err: any) {
      toast({
        title: '删除失败',
        description: err?.response?.data?.error || err?.message || '操作失败',
        variant: 'destructive',
      })
    }
  }

  const buildTags = () => {
    const free = form.tags ? form.tags.split(',').map((s:string)=>({name:s.trim()})).filter((s:any)=>s.name && !['vision','file_upload','web_search','image_generation','code_interpreter'].includes(s.name)) : []
    const caps = CAP_KEYS.filter((key)=>cap[key]).map((key)=>({ name: key }))
    return [...free, ...caps]
  }

  const buildPayload = () => ({
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
  })

  const onVerify = async () => {
    try {
      await apiClient.verifySystemConnection(buildPayload())
      toast({ title: '验证成功', description: '连接可用，配置已通过测试。' })
    } catch (err: any) {
      toast({
        title: '验证失败',
        description: err?.response?.data?.error || err?.message || '无法完成验证',
        variant: 'destructive',
      })
    }
  }

  const onSubmit = async () => {
    try {
      if (editing) await apiClient.updateSystemConnection(editing.id, buildPayload())
      else await apiClient.createSystemConnection(buildPayload())
      toast({ title: editing ? '连接已更新' : '连接已创建' })
      setEditing(null)
      resetForm()
      await load()
    } catch (err: any) {
      toast({
        title: '保存失败',
        description: err?.response?.data?.error || err?.message || '无法保存连接配置',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">

      {/* 连接表单区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Link2 className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">连接配置</CardTitle>
            <CardDescription>配置API端点和认证信息</CardDescription>
          </div>
        </div>

        {error && <div className="text-sm text-destructive px-4 py-3 bg-destructive/10 rounded">{error}</div>}

        <Card className="space-y-3 px-4 py-4 sm:px-5 sm:py-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Provider</Label>
            <Select
              value={form.provider}
              onValueChange={(v) =>
                setForm((f: any) => ({
                  ...f,
                  provider: v,
                  authType: v === 'google_genai' ? 'bearer' : f.authType,
                }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="azure_openai">Azure OpenAI</SelectItem>
                <SelectItem value="ollama">Ollama</SelectItem>
                <SelectItem value="google_genai">Google Generative AI</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Auth</Label>
            <Select
              value={form.authType}
              onValueChange={(v) => setForm((f: any) => ({ ...f, authType: v }))}
              disabled={form.provider === 'google_genai'}
            >
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
            <Input
              value={form.baseUrl}
              onChange={(e) => setForm((f: any) => ({ ...f, baseUrl: e.target.value }))}
              placeholder={
                form.provider === 'ollama'
                  ? 'http://localhost:11434'
                  : form.provider === 'google_genai'
                  ? 'https://generativelanguage.googleapis.com/v1beta'
                  : 'https://api.openai.com/v1'
              }
            />
            {form.provider === 'google_genai' && (
              <p className="mt-1 text-xs text-muted-foreground">
                需要在 Google AI Studio 控制台启用 API 并配置 API Key，默认基地址为
                https://generativelanguage.googleapis.com/v1beta
              </p>
            )}
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
              {CAP_KEYS.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <Checkbox
                    id={`cap-${k}`}
                    checked={cap[k]}
                    onCheckedChange={(value)=>setCap((prev)=>{
                      const next = { ...prev }
                      next[k] = value === true
                      return next
                    })}
                  />
                  <Label htmlFor={`cap-${k}`} className="font-normal">{CAP_LABELS[k]}</Label>
                </div>
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
        </Card>
      </div>

      {/* 连接列表区块 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">已配置的连接</CardTitle>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>刷新</Button>
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

          {rows.map((r:any) => {
            const channelLabel = deriveChannelName(r.provider, r.baseUrl)
            return (
              <Card key={r.id} className="px-4 py-4 sm:px-5 sm:py-5 transition-all hover:border-primary/30 hover:shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="font-medium text-lg">{channelLabel}</div>
                    <div className="text-sm text-muted-foreground break-all">{r.baseUrl}</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Provider: {r.provider}</span>
                      <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Auth: {r.authType}</span>
                      {r.prefixId && <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Prefix: {r.prefixId}</span>}
                      <span className="px-2 py-1 rounded bg-muted text-muted-foreground">Type: {r.connectionType}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={()=>onEdit(r)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={()=>onDelete(r.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
