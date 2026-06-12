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
import * as secretVaultApi from '@/features/secret-vault/api'
import type { McpInstallation, McpConnection, SecretView } from '@/types'
import { Plus, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ConnectionsTab() {
  const { toast } = useToast()
  const [items, setItems] = useState<McpConnection[]>([])
  const [installations, setInstallations] = useState<McpInstallation[]>([])
  const [secrets, setSecrets] = useState<SecretView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState<number | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showSecretCreate, setShowSecretCreate] = useState(false)
  const [secretLabel, setSecretLabel] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [secretCreating, setSecretCreating] = useState(false)

  // Form state
  const [formInstId, setFormInstId] = useState('')
  const [formName, setFormName] = useState('')
  const [formConfig, setFormConfig] = useState('')
  const [formSecretVaultId, setFormSecretVaultId] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [connRes, instRes, secretRes] = await Promise.all([
        mcpApi.listConnections(),
        mcpApi.listInstallations(),
        secretVaultApi.listSecrets({ scope: 'system', kind: 'mcp_credential' }),
      ])
      setItems(connRes.data ?? [])
      setInstallations(instRes.data ?? [])
      setSecrets(secretRes.data ?? [])
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || '加载失败')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditId(null); setFormInstId(''); setFormName(''); setFormConfig(''); setFormSecretVaultId(''); setFormEnabled(true); setShowForm(true)
  }

  const openEdit = (conn: McpConnection) => {
    setEditId(conn.id)
    setFormInstId(String(conn.installationId))
    setFormName(conn.name)
    setFormConfig(conn.configJson ?? '')
    setFormSecretVaultId(conn.secretVaultId ? String(conn.secretVaultId) : '')
    setFormEnabled(conn.enabled)
    setShowForm(true)
  }

  const handleRefresh = async (id: number) => {
    setRefreshing(id)
    try {
      const res = await mcpApi.refreshConnectionTools(id)
      toast({ title: '工具缓存已刷新', description: `Revision: ${res.data?.toolSetRevision}` })
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 501 || status === 500) {
        toast({ title: '刷新失败', description: '后端返回 501/500，可能 Gateway 未就绪', variant: 'destructive' })
      } else {
        toast({ title: '刷新失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
      }
    } finally { setRefreshing(null) }
  }

  const handleSave = async () => {
    if (!formInstId || !formName) { toast({ title: 'installationId 和 name 必填', variant: 'destructive' }); return }
    setSaving(true)
    try {
      const payload = {
        installationId: Number(formInstId), name: formName, enabled: formEnabled,
        configJson: formConfig || undefined,
        secretVaultId: formSecretVaultId ? Number(formSecretVaultId) : undefined,
      }
      if (editId) {
        const updatePayload: any = { name: formName, enabled: formEnabled, configJson: formConfig || undefined }
        if (formSecretVaultId) updatePayload.secretVaultId = Number(formSecretVaultId)
        else updatePayload.secretVaultId = null
        await mcpApi.updateConnection(editId, updatePayload)
        toast({ title: '连接已更新' })
      } else {
        await mcpApi.createSystemConnection(payload)
        toast({ title: '连接已创建' })
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
      await mcpApi.deleteConnection(deleteId)
      toast({ title: '已删除' }); setDeleteId(null); load()
    } catch (err: any) {
      toast({ title: '删除失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    } finally { setDeleting(false) }
  }

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      await mcpApi.updateConnection(id, { enabled })
      setItems((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)))
    } catch (err: any) {
      toast({ title: '操作失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    }
  }

  const handleQuickCreateSecret = async () => {
    if (!secretLabel || !secretValue) { toast({ title: 'label 和 value 必填', variant: 'destructive' }); return }
    setSecretCreating(true)
    try {
      const res = await secretVaultApi.createSecret({ scope: 'system', kind: 'mcp_credential', label: secretLabel, value: secretValue })
      toast({ title: '凭据已创建' })
      setFormSecretVaultId(String(res.data?.id))
      setShowSecretCreate(false); setSecretLabel(''); setSecretValue('')
      // Reload secrets list
      const secretRes = await secretVaultApi.listSecrets({ scope: 'system', kind: 'mcp_credential' })
      setSecrets(secretRes.data ?? [])
    } catch (err: any) {
      toast({ title: '创建凭据失败', description: err?.response?.data?.error || err.message, variant: 'destructive' })
    } finally { setSecretCreating(false) }
  }

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
  if (error) return <p className="text-sm text-destructive">{error}</p>

  const instMap = new Map(installations.map((i) => [i.id, i]))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">共 {items.length} 个连接</p>
        <Button size="sm" variant="outline" onClick={openCreate}><Plus className="mr-1 h-3.5 w-3.5" />新建</Button>
      </div>

      {showForm && (
        <SectionCard>
          <p className="text-xs font-semibold">{editId ? '编辑连接' : '新建连接'}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">安装 *</label>
              <select className="h-9 w-full rounded-md border bg-background px-3 text-xs" value={formInstId} onChange={(e) => setFormInstId(e.target.value)}>
                <option value="">选择...</option>
                {installations.map((i) => <option key={i.id} value={i.id}>{i.namespaceKey}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">名称 *</label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">configJson</label>
              <Input value={formConfig} onChange={(e) => setFormConfig(e.target.value)} placeholder='{"key": "val"}' />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Secret Vault 凭据</label>
              <div className="flex gap-1">
                <select className="h-9 flex-1 rounded-md border bg-background px-3 text-xs" value={formSecretVaultId} onChange={(e) => setFormSecretVaultId(e.target.value)}>
                  <option value="">无（不关联凭据）</option>
                  {secrets.map((s) => <option key={s.id} value={s.id}>{s.label} (ID:{s.id})</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={() => setShowSecretCreate(!showSecretCreate)} title="快速创建凭据">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
              <span className="text-xs text-muted-foreground">启用</span>
            </div>
          </div>

          {showSecretCreate && (
            <div className="border rounded-md p-3 space-y-2 mt-2">
              <p className="text-xs font-medium text-muted-foreground">快速创建 MCP 凭据</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input placeholder="标签（如 My API Key）" value={secretLabel} onChange={(e) => setSecretLabel(e.target.value)} />
                <Input type="password" placeholder="凭据值" value={secretValue} onChange={(e) => setSecretValue(e.target.value)} />
              </div>
              <Button size="sm" onClick={handleQuickCreateSecret} disabled={secretCreating}>
                {secretCreating ? '创建中...' : '创建并选择'}
              </Button>
            </div>
          )}

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
              <th className="py-2 pr-3">名称</th>
              <th className="py-2 pr-3">安装</th>
              <th className="py-2 pr-3">启用</th>
              <th className="py-2 pr-3">状态</th>
              <th className="py-2 pr-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">暂无连接</td></tr>}
            {items.map((conn) => (
              <tr key={conn.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="py-2 pr-3">{conn.name}</td>
                <td className="py-2 pr-3 font-mono text-[10px]">{instMap.get(conn.installationId)?.namespaceKey ?? conn.installationId}</td>
                <td className="py-2 pr-3"><Switch checked={conn.enabled} onCheckedChange={(v) => handleToggle(conn.id, v)} /></td>
                <td className="py-2 pr-3"><Badge variant={conn.status === 'active' ? 'default' : conn.status === 'error' ? 'destructive' : 'secondary'} className="text-[10px]">{conn.status || 'unknown'}</Badge></td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => openEdit(conn)} title="编辑"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => handleRefresh(conn.id)} disabled={refreshing === conn.id} title="刷新工具缓存">
                      <RefreshCw className={cn('h-3.5 w-3.5', refreshing === conn.id && 'animate-spin')} />
                    </button>
                    <button type="button" onClick={() => setDeleteId(conn.id)} title="删除"><Trash2 className="h-3.5 w-3.5 text-destructive/70 hover:text-destructive" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除连接</AlertDialogTitle>
            <AlertDialogDescription>此操作不可撤销，关联的绑定和工具缓存也将被删除。</AlertDialogDescription>
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
