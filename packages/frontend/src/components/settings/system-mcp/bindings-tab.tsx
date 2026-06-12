'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SectionCard } from './tab-bar'
import * as mcpApi from '@/features/mcp/api'
import type { McpBinding, McpConnection } from '@/types'
import { Plus, Trash2 } from 'lucide-react'

export function BindingsTab() {
  const { toast } = useToast()
  const [items, setItems] = useState<McpBinding[]>([])
  const [connections, setConnections] = useState<McpConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [formConnId, setFormConnId] = useState('')
  const [formScopeType, setFormScopeType] = useState<'system' | 'user' | 'session' | 'battle_model'>('system')
  const [formScopeId, setFormScopeId] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [bindRes, connRes] = await Promise.all([mcpApi.listBindings(), mcpApi.listConnections()])
      setItems(bindRes.data ?? [])
      setConnections(connRes.data ?? [])
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载失败')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!formConnId || !formScopeId) { toast({ title: 'connectionId 和 scopeId 必填', variant: 'destructive' }); return }
    setSaving(true)
    try {
      await mcpApi.createBinding({ connectionId: Number(formConnId), scopeType: formScopeType, scopeId: formScopeId, enabled: formEnabled })
      toast({ title: '绑定已创建' })
      setShowForm(false); setFormConnId(''); setFormScopeId(''); setFormEnabled(true); load()
    } catch (err: any) {
      toast({ title: '创建失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      await mcpApi.updateBinding(id, { enabled })
      setItems((prev) => prev.map((b) => (b.id === id ? { ...b, enabled } : b)))
    } catch (err: any) {
      toast({ title: '操作失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await mcpApi.deleteBinding(deleteId)
      toast({ title: '已删除' }); setDeleteId(null); load()
    } catch (err: any) {
      toast({ title: '删除失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    } finally { setDeleting(false) }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  if (error) return <p className="text-sm text-destructive">{error}</p>

  const connMap = new Map(connections.map((c) => [c.id, c]))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">共 {items.length} 个绑定</p>
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}><Plus className="mr-1 h-3.5 w-3.5" />新建</Button>
      </div>

      {showForm && (
        <SectionCard>
          <p className="text-xs font-semibold">新建绑定</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">connectionId *</label>
              <select className="h-9 w-full rounded-md border bg-background px-3 text-xs" value={formConnId} onChange={(e) => setFormConnId(e.target.value)}>
                <option value="">选择...</option>
                {connections.map((c) => <option key={c.id} value={c.id}>{c.name} (ID:{c.id})</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">scopeType</label>
              <select className="h-9 w-full rounded-md border bg-background px-3 text-xs" value={formScopeType} onChange={(e) => setFormScopeType(e.target.value as any)}>
                <option value="system">system</option>
                <option value="user">user</option>
                <option value="session">session</option>
                <option value="battle_model">battle_model</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">scopeId *</label>
              <Input value={formScopeId} onChange={(e) => setFormScopeId(e.target.value)} placeholder="如 'system' 或用户ID" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
              <span className="text-xs text-muted-foreground">启用</span>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={handleCreate} disabled={saving}>{saving ? '创建中...' : '创建'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </SectionCard>
      )}

      <div className="v2-table-wrap">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-2 pr-3">ID</th>
              <th className="py-2 pr-3">连接</th>
              <th className="py-2 pr-3">scope</th>
              <th className="py-2 pr-3">scopeId</th>
              <th className="py-2 pr-3">启用</th>
              <th className="py-2 pr-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">暂无绑定</td></tr>}
            {items.map((b) => (
              <tr key={b.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-2 pr-3 font-mono">{b.id}</td>
                <td className="py-2 pr-3">{connMap.get(b.connectionId)?.name ?? b.connectionId}</td>
                <td className="py-2 pr-3"><Badge variant="outline" className="text-[10px]">{b.scopeType}</Badge></td>
                <td className="py-2 pr-3 font-mono text-[10px]">{b.scopeId}</td>
                <td className="py-2 pr-3">
                  <Switch checked={b.enabled} onCheckedChange={(v) => handleToggle(b.id, v)} />
                </td>
                <td className="py-2 pr-3">
                  <button type="button" onClick={() => setDeleteId(b.id)} title="删除"><Trash2 className="h-3.5 w-3.5 text-destructive/70 hover:text-destructive" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除绑定</AlertDialogTitle>
            <AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>{deleting ? '删除中...' : '确认删除'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
