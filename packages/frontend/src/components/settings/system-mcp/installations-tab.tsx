'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { McpListHeader, McpEmptyState, McpFormPanel, McpField, McpSelectField, McpInlineWarning } from './mcp-ui'
import * as mcpApi from '@/features/mcp/api'
import type { McpInstallation } from '@/types'
import { Package, Pencil } from 'lucide-react'

interface FormState {
  namespaceKey: string; name: string; description: string
  sourceType: 'remote' | 'local_package'
  transport: 'streamable_http' | 'sse' | 'stdio'
  endpoint: string; command: string
  argsJson: string; envJson: string
  sourceUrl: string; sourceKey: string; registrySource: string
}

const EMPTY_FORM: FormState = {
  namespaceKey: '', name: '', description: '',
  sourceType: 'remote', transport: 'streamable_http',
  endpoint: '', command: '', argsJson: '', envJson: '',
  sourceUrl: '', sourceKey: '', registrySource: '',
}

export function InstallationsTab() {
  const { toast } = useToast()
  const [items, setItems] = useState<McpInstallation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await mcpApi.listInstallations()
      setItems(res.data ?? [])
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载失败')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true) }
  const openEdit = (inst: McpInstallation) => {
    setEditId(inst.id)
    setForm({
      namespaceKey: inst.namespaceKey, name: inst.name,
      description: inst.description ?? '',
      sourceType: (inst.sourceType as any) ?? 'remote',
      transport: (inst.transport as any) ?? 'streamable_http',
      endpoint: inst.endpoint ?? '', command: inst.command ?? '',
      argsJson: inst.argsJson ?? '', envJson: inst.envJson ?? '',
      sourceUrl: inst.sourceUrl ?? '', sourceKey: inst.sourceKey ?? '',
      registrySource: inst.registrySource ?? '',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.namespaceKey || !form.name) {
      toast({ title: 'namespaceKey 和 name 不能为空', variant: 'destructive' }); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        description: form.description || undefined,
        endpoint: form.endpoint || undefined,
        command: form.command || undefined,
        argsJson: form.argsJson || undefined,
        envJson: form.envJson || undefined,
        sourceUrl: form.sourceUrl || undefined,
        sourceKey: form.sourceKey || undefined,
        registrySource: form.registrySource || undefined,
      }
      if (editId) {
        await mcpApi.updateInstallation(editId, payload as any)
        toast({ title: '安装模板已更新' })
      } else {
        await mcpApi.createInstallation(payload as any)
        toast({ title: '安装模板已创建' })
      }
      setShowForm(false); load()
    } catch (err: any) {
      toast({ title: editId ? '更新失败' : '创建失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <div className="space-y-3">
      <McpListHeader count={items.length} actionLabel="新建" onAction={openCreate} />

      {showForm && (
        <McpFormPanel
          title={editId ? '编辑安装模板' : '新建安装模板'}
          actions={
            <>
              <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
            </>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <McpField label="namespaceKey" required><Input value={form.namespaceKey} onChange={(e) => setForm({ ...form, namespaceKey: e.target.value })} /></McpField>
            <McpField label="名称" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></McpField>
            <div className="md:col-span-2"><McpField label="描述"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></McpField></div>
            <McpSelectField label="sourceType" value={form.sourceType} onChange={(v) => setForm({ ...form, sourceType: v as any })} options={['remote', 'local_package']} />
            <McpSelectField label="transport" value={form.transport} onChange={(v) => setForm({ ...form, transport: v as any })} options={['streamable_http', 'sse', 'stdio']} />
            <McpField label="Endpoint / SourceUrl"><Input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} /></McpField>
            <McpField label="Command（stdio）"><Input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} /></McpField>
            <McpField label="argsJson"><Input value={form.argsJson} onChange={(e) => setForm({ ...form, argsJson: e.target.value })} /></McpField>
            <McpField label="envJson"><Input value={form.envJson} onChange={(e) => setForm({ ...form, envJson: e.target.value })} /></McpField>
            <McpField label="sourceUrl"><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} /></McpField>
            <McpField label="sourceKey"><Input value={form.sourceKey} onChange={(e) => setForm({ ...form, sourceKey: e.target.value })} /></McpField>
            <McpField label="registrySource"><Input value={form.registrySource} onChange={(e) => setForm({ ...form, registrySource: e.target.value })} /></McpField>
          </div>
        </McpFormPanel>
      )}

      {form.sourceType === 'local_package' && !showForm && (
        <McpInlineWarning>
          local_package 需要 Gateway，当前仅管理员模板管理，连接/刷新可能被阻断。
        </McpInlineWarning>
      )}

      {items.length === 0 ? (
        <McpEmptyState icon={Package} title="暂无安装模板" description="创建一个安装模板来定义工具的连接方式和参数" action={{ label: '新建模板', onClick: openCreate }} />
      ) : (
        <div className="v2-table-wrap">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">namespaceKey</th>
                <th className="py-2 pr-3">名称</th>
                <th className="py-2 pr-3">类型</th>
                <th className="py-2 pr-3">传输</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 pr-3 font-mono max-w-[140px] truncate" title={item.namespaceKey}>{item.namespaceKey}</td>
                  <td className="py-2 pr-3">{item.name}</td>
                  <td className="py-2 pr-3"><Badge variant="outline" className="text-[10px]">{item.sourceType}</Badge></td>
                  <td className="py-2 pr-3"><Badge variant="outline" className="text-[10px]">{item.transport}</Badge></td>
                  <td className="py-2 pr-3"><Badge variant={item.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{item.status || 'unknown'}</Badge></td>
                  <td className="py-2 pr-3">
                    <button type="button" onClick={() => openEdit(item)} title="编辑" className="inline-flex p-1 rounded hover:bg-accent"><Pencil className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
