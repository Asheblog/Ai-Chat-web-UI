'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { SectionCard } from './tab-bar'
import * as mcpApi from '@/features/mcp/api'
import type { McpInstallation } from '@/types'
import { Plus, Pencil } from 'lucide-react'

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

  const openCreate = () => {
    setEditId(null); setForm(EMPTY_FORM); setShowForm(true)
  }

  const openEdit = (inst: McpInstallation) => {
    setEditId(inst.id)
    setForm({
      namespaceKey: inst.namespaceKey,
      name: inst.name,
      description: inst.description ?? '',
      sourceType: (inst.sourceType as any) ?? 'remote',
      transport: (inst.transport as any) ?? 'streamable_http',
      endpoint: inst.endpoint ?? '',
      command: inst.command ?? '',
      argsJson: inst.argsJson ?? '',
      envJson: inst.envJson ?? '',
      sourceUrl: inst.sourceUrl ?? '',
      sourceKey: inst.sourceKey ?? '',
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
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">共 {items.length} 个安装</p>
        <Button size="sm" variant="outline" onClick={openCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" />新建
        </Button>
      </div>

      {showForm && (
        <SectionCard>
          <p className="text-xs font-semibold">{editId ? '编辑安装模板' : '新建安装模板'}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="namespaceKey *"><Input value={form.namespaceKey} onChange={(e) => setForm({ ...form, namespaceKey: e.target.value })} /></Field>
            <Field label="名称 *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="描述"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
            <EnumField label="sourceType" value={form.sourceType} onChange={(v) => setForm({ ...form, sourceType: v as any })} options={['remote', 'local_package']} />
            <EnumField label="transport" value={form.transport} onChange={(v) => setForm({ ...form, transport: v as any })} options={['streamable_http', 'sse', 'stdio']} />
            <Field label="Endpoint / SourceUrl"><Input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} /></Field>
            <Field label="Command（stdio）"><Input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} /></Field>
            <Field label="argsJson"><Input value={form.argsJson} onChange={(e) => setForm({ ...form, argsJson: e.target.value })} /></Field>
            <Field label="envJson"><Input value={form.envJson} onChange={(e) => setForm({ ...form, envJson: e.target.value })} /></Field>
            <Field label="sourceUrl"><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} /></Field>
            <Field label="sourceKey"><Input value={form.sourceKey} onChange={(e) => setForm({ ...form, sourceKey: e.target.value })} /></Field>
            <Field label="registrySource"><Input value={form.registrySource} onChange={(e) => setForm({ ...form, registrySource: e.target.value })} /></Field>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </SectionCard>
      )}

      {form.sourceType === 'local_package' && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          local_package 需要 Gateway，当前仅管理员模板管理，连接/刷新可能被阻断。
        </p>
      )}

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
            {items.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">暂无安装</td></tr>}
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-2 pr-3 font-mono">{item.namespaceKey}</td>
                <td className="py-2 pr-3">{item.name}</td>
                <td className="py-2 pr-3"><Badge variant="outline" className="text-[10px]">{item.sourceType}</Badge></td>
                <td className="py-2 pr-3"><Badge variant="outline" className="text-[10px]">{item.transport}</Badge></td>
                <td className="py-2 pr-3"><Badge variant={item.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{item.status || 'unknown'}</Badge></td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openEdit(item)} title="编辑"><Pencil className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-xs text-muted-foreground">{label}</label>{children}</div>
}

function EnumField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Field label={label}>
      <select className="h-9 w-full rounded-md border bg-background px-3 text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  )
}
