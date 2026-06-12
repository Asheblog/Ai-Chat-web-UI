'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SectionCard } from './tab-bar'
import * as secretVaultApi from '@/features/secret-vault/api'
import type { SecretView } from '@/types'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export function SecretsTab() {
  const { toast } = useToast()
  const [items, setItems] = useState<SecretView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Form state
  const [formScope, setFormScope] = useState<'system' | 'user'>('system')
  const [formKind, setFormKind] = useState<'api_key' | 'mcp_credential' | 'skill_secret'>('mcp_credential')
  const [formLabel, setFormLabel] = useState('')
  const [formValue, setFormValue] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await secretVaultApi.listSecrets({ kind: 'mcp_credential' })
      setItems(res.data ?? [])
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载失败')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditId(null); setFormScope('system'); setFormKind('mcp_credential'); setFormLabel(''); setFormValue(''); setShowForm(true)
  }

  const openEdit = (s: SecretView) => {
    setEditId(s.id); setFormScope(s.scope as any); setFormKind(s.kind as any); setFormLabel(s.label); setFormValue(''); setShowForm(true)
  }

  const handleSave = async () => {
    if (!formLabel) { toast({ title: 'label 必填', variant: 'destructive' }); return }
    if (!editId && !formValue) { toast({ title: '创建时必须提供 value', variant: 'destructive' }); return }
    setSaving(true)
    try {
      if (editId) {
        const payload: any = { label: formLabel, kind: formKind }
        if (formValue) payload.value = formValue
        await secretVaultApi.updateSecret(editId, payload)
        toast({ title: '凭据已更新' })
      } else {
        await secretVaultApi.createSecret({ scope: formScope, kind: formKind, label: formLabel, value: formValue })
        toast({ title: '凭据已创建' })
      }
      setShowForm(false); load()
    } catch (err: any) {
      toast({ title: editId ? '更新失败' : '创建失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    } finally { setSaving(false) }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await secretVaultApi.deleteSecret(deleteId)
      toast({ title: '已删除' }); setDeleteId(null); load()
    } catch (err: any) {
      toast({ title: '删除失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    } finally { setDeleting(false) }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">共 {items.length} 个凭据</p>
        <Button size="sm" variant="outline" onClick={openCreate}><Plus className="mr-1 h-3.5 w-3.5" />新建</Button>
      </div>

      {showForm && (
        <SectionCard>
          <p className="text-xs font-semibold">{editId ? '编辑凭据' : '新建凭据'}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">scope</label>
              <select className="h-9 w-full rounded-md border bg-background px-3 text-xs" value={formScope} onChange={(e) => setFormScope(e.target.value as any)}>
                <option value="system">system</option>
                <option value="user">user</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">kind</label>
              <select className="h-9 w-full rounded-md border bg-background px-3 text-xs" value={formKind} onChange={(e) => setFormKind(e.target.value as any)}>
                <option value="mcp_credential">mcp_credential</option>
                <option value="api_key">api_key</option>
                <option value="skill_secret">skill_secret</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">标签 *</label>
              <Input value={formLabel} onChange={(e) => setFormLabel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{editId ? '新值（留空不改）' : '值 *'}</label>
              <Input type="password" value={formValue} onChange={(e) => setFormValue(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </SectionCard>
      )}

      <div className="v2-table-wrap">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="py-2 pr-3">ID</th>
              <th className="py-2 pr-3">标签</th>
              <th className="py-2 pr-3">scope</th>
              <th className="py-2 pr-3">kind</th>
              <th className="py-2 pr-3">有值</th>
              <th className="py-2 pr-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">暂无凭据</td></tr>}
            {items.map((s) => (
              <tr key={s.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-2 pr-3 font-mono">{s.id}</td>
                <td className="py-2 pr-3">{s.label}</td>
                <td className="py-2 pr-3"><Badge variant="outline" className="text-[10px]">{s.scope}</Badge></td>
                <td className="py-2 pr-3"><Badge variant="outline" className="text-[10px]">{s.kind}</Badge></td>
                <td className="py-2 pr-3">{s.hasValue ? '是' : '否'}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openEdit(s)} title="编辑"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setDeleteId(s.id)} title="删除"><Trash2 className="h-3.5 w-3.5 text-destructive/70 hover:text-destructive" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除凭据</AlertDialogTitle>
            <AlertDialogDescription>此操作不可撤销。关联连接的凭据引用将失效。</AlertDialogDescription>
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
