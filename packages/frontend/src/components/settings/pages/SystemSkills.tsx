'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import {
  activateSkillVersion,
  approveSkillVersion,
  deleteSkillBinding,
  installSkillFromGithub,
  listSkillApprovals,
  listSkillBindings,
  listSkillCatalog,
  respondSkillApproval,
  upsertSkillBinding,
} from '@/features/skills/api'
import type { SkillApprovalRequestItem, SkillBindingItem, SkillCatalogItem, SkillVersionItem } from '@/types'

type ScopeType = 'system' | 'user' | 'session' | 'battle_model'

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  pending_validation: 'secondary',
  pending_approval: 'outline',
  rejected: 'destructive',
  deprecated: 'outline',
}

const parseDraftJson = (value: string, fieldName: string) => {
  const trimmed = value.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象`)
  }
  return parsed as Record<string, unknown>
}

const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return date.toLocaleString()
}

const resolveVersionLabel = (
  skill: SkillCatalogItem | undefined,
  versionId: number | null | undefined,
) => {
  if (!skill) return versionId ? String(versionId) : 'default'
  if (!versionId) return skill.defaultVersion?.version || 'default'
  const version = skill.versions?.find((item) => item.id === versionId)
  return version?.version || String(versionId)
}

export function SystemSkillsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [versionActionKey, setVersionActionKey] = useState<string | null>(null)
  const [bindingSubmitting, setBindingSubmitting] = useState(false)
  const [approvalActionId, setApprovalActionId] = useState<number | null>(null)

  const [catalog, setCatalog] = useState<SkillCatalogItem[]>([])
  const [bindings, setBindings] = useState<SkillBindingItem[]>([])
  const [approvals, setApprovals] = useState<SkillApprovalRequestItem[]>([])

  const [installSource, setInstallSource] = useState('')
  const [installToken, setInstallToken] = useState('')

  const [bindingSkillId, setBindingSkillId] = useState<number | null>(null)
  const [bindingVersionId, setBindingVersionId] = useState<string>('default')
  const [bindingScopeType, setBindingScopeType] = useState<ScopeType>('system')
  const [bindingScopeId, setBindingScopeId] = useState('global')
  const [bindingEnabled, setBindingEnabled] = useState(true)
  const [bindingPolicyDraft, setBindingPolicyDraft] = useState('')
  const [bindingOverridesDraft, setBindingOverridesDraft] = useState('')

  const selectedSkill = useMemo(
    () => catalog.find((item) => item.id === bindingSkillId) || null,
    [catalog, bindingSkillId],
  )

  const refreshAll = useCallback(async (initial = false) => {
    if (initial) {
      setLoading(true)
    } else {
      setRefreshing(true)
    }
    try {
      const [catalogResponse, bindingsResponse, approvalsResponse] = await Promise.all([
        listSkillCatalog({ all: true, includeVersions: true }),
        listSkillBindings(),
        listSkillApprovals({ status: 'pending', limit: 100 }),
      ])

      const nextCatalog = Array.isArray(catalogResponse?.data) ? catalogResponse.data : []
      const nextBindings = Array.isArray(bindingsResponse?.data) ? bindingsResponse.data : []
      const nextApprovals = Array.isArray(approvalsResponse?.data) ? approvalsResponse.data : []

      setCatalog(nextCatalog)
      setBindings(nextBindings)
      setApprovals(nextApprovals)

      if (nextCatalog.length > 0) {
        setBindingSkillId((prev) => {
          if (prev && nextCatalog.some((item) => item.id === prev)) return prev
          return nextCatalog[0].id
        })
      } else {
        setBindingSkillId(null)
      }
    } catch (error) {
      toast({
        title: '加载 Skill 数据失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      if (initial) {
        setLoading(false)
      } else {
        setRefreshing(false)
      }
    }
  }, [toast])

  useEffect(() => {
    refreshAll(true)
  }, [refreshAll])

  const handleInstall = async () => {
    const source = installSource.trim()
    if (!source) {
      toast({
        title: '请输入仓库地址',
        description: '格式：owner/repo@ref 或 owner/repo@ref:subdir',
        variant: 'destructive',
      })
      return
    }
    setInstalling(true)
    try {
      const response = await installSkillFromGithub({
        source,
        token: installToken.trim() ? installToken.trim() : undefined,
      })
      if (!response?.success) {
        throw new Error(response?.error || '安装失败')
      }
      toast({
        title: 'Skill 安装请求已完成',
        description: '请根据版本状态继续审批或激活',
      })
      await refreshAll(false)
      setInstallSource('')
      setInstallToken('')
    } catch (error) {
      toast({
        title: '安装失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setInstalling(false)
    }
  }

  const handleApproveVersion = async (skillId: number, versionId: number) => {
    const key = `approve:${skillId}:${versionId}`
    setVersionActionKey(key)
    try {
      const response = await approveSkillVersion(skillId, versionId)
      if (!response?.success) {
        throw new Error(response?.error || '审批失败')
      }
      toast({ title: '版本审批成功' })
      await refreshAll(false)
    } catch (error) {
      toast({
        title: '版本审批失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setVersionActionKey(null)
    }
  }

  const handleActivateVersion = async (skillId: number, versionId: number) => {
    const key = `activate:${skillId}:${versionId}`
    setVersionActionKey(key)
    try {
      const response = await activateSkillVersion(skillId, versionId, { makeDefault: true })
      if (!response?.success) {
        throw new Error(response?.error || '激活失败')
      }
      toast({ title: '版本已激活并设为默认' })
      await refreshAll(false)
    } catch (error) {
      toast({
        title: '版本激活失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setVersionActionKey(null)
    }
  }

  const handleUpsertBinding = async () => {
    if (!bindingSkillId) {
      toast({ title: '请先选择 Skill', variant: 'destructive' })
      return
    }
    setBindingSubmitting(true)
    try {
      const policy = parseDraftJson(bindingPolicyDraft, '策略 JSON')
      const overrides = parseDraftJson(bindingOverridesDraft, '覆盖配置 JSON')
      const versionId =
        bindingVersionId === 'default' ? null : Number.parseInt(bindingVersionId, 10)
      const response = await upsertSkillBinding({
        skillId: bindingSkillId,
        versionId: Number.isFinite(versionId) ? versionId : null,
        scopeType: bindingScopeType,
        scopeId: bindingScopeId.trim() || 'global',
        enabled: bindingEnabled,
        policy,
        overrides,
      })
      if (!response?.success) {
        throw new Error(response?.error || '绑定失败')
      }
      toast({ title: '绑定已保存' })
      await refreshAll(false)
    } catch (error) {
      toast({
        title: '保存绑定失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setBindingSubmitting(false)
    }
  }

  const handleDeleteBinding = async (bindingId: number) => {
    try {
      const response = await deleteSkillBinding(bindingId)
      if (!response?.success) {
        throw new Error(response?.error || '删除失败')
      }
      toast({ title: '绑定已删除' })
      setBindings((prev) => prev.filter((item) => item.id !== bindingId))
    } catch (error) {
      toast({
        title: '删除绑定失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    }
  }

  const handleRespondApproval = async (requestId: number, approved: boolean) => {
    setApprovalActionId(requestId)
    try {
      const response = await respondSkillApproval(requestId, { approved })
      if (!response?.success) {
        throw new Error(response?.error || '处理失败')
      }
      toast({ title: approved ? '审批已通过' : '审批已拒绝' })
      setApprovals((prev) => prev.filter((item) => item.id !== requestId))
    } catch (error) {
      toast({
        title: '审批处理失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setApprovalActionId(null)
    }
  }

  const versionOptions: SkillVersionItem[] = selectedSkill?.versions || []

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Skill 安装</CardTitle>
          <CardDescription>
            支持 GitHub `owner/repo@ref[:subdir]`，例如 `aichat/skills-repo@main:skills/web-search`。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_280px_auto]">
            <div className="space-y-1">
              <Label>GitHub Source</Label>
              <Input
                value={installSource}
                onChange={(event) => setInstallSource(event.target.value)}
                placeholder="owner/repo@ref[:subdir]"
              />
            </div>
            <div className="space-y-1">
              <Label>Token（可选）</Label>
              <Input
                type="password"
                value={installToken}
                onChange={(event) => setInstallToken(event.target.value)}
                placeholder="仅私有仓库需要"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleInstall} disabled={installing} className="w-full md:w-auto">
                {installing ? '安装中...' : '安装'}
              </Button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => refreshAll(false)} disabled={refreshing}>
              {refreshing ? '刷新中...' : '刷新数据'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>待审批调用</CardTitle>
          <CardDescription>高风险 Skill 调用会在此出现，处理后调用继续或终止。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : approvals.length === 0 ? (
            <div className="text-sm text-muted-foreground">当前没有待审批请求。</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Skill</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead>请求方</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {approvals.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">#{item.id}</TableCell>
                    <TableCell>{item.skill?.slug || item.skillId}</TableCell>
                    <TableCell className="font-mono text-xs">{item.toolName}</TableCell>
                    <TableCell className="text-xs">{item.requestedByActor}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(item.expiresAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={approvalActionId === item.id}
                          onClick={() => handleRespondApproval(item.id, false)}
                        >
                          拒绝
                        </Button>
                        <Button
                          size="sm"
                          disabled={approvalActionId === item.id}
                          onClick={() => handleRespondApproval(item.id, true)}
                        >
                          批准
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skill 版本管理</CardTitle>
          <CardDescription>审批通过后可激活版本。激活时会覆盖该 Skill 的默认版本。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : catalog.length === 0 ? (
            <div className="text-sm text-muted-foreground">当前没有可管理的 Skill。</div>
          ) : (
            catalog.map((skill) => (
              <div key={skill.id} className="rounded-lg border border-border/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{skill.displayName}</h3>
                  <Badge variant="outline">{skill.slug}</Badge>
                  <Badge variant={STATUS_BADGE_VARIANT[skill.status || ''] || 'outline'}>
                    {skill.status || 'unknown'}
                  </Badge>
                  {skill.defaultVersion ? (
                    <Badge variant="secondary">default: {skill.defaultVersion.version}</Badge>
                  ) : null}
                </div>
                {skill.description ? (
                  <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                ) : null}

                <div className="space-y-2">
                  {(skill.versions || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无版本</p>
                  ) : (
                    (skill.versions || []).map((version) => {
                      const isDefault = skill.defaultVersion?.id === version.id
                      const approving = versionActionKey === `approve:${skill.id}:${version.id}`
                      const activating = versionActionKey === `activate:${skill.id}:${version.id}`
                      return (
                        <div
                          key={version.id}
                          className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs">{version.version}</span>
                              <Badge variant={STATUS_BADGE_VARIANT[version.status || ''] || 'outline'}>
                                {version.status}
                              </Badge>
                              <Badge variant="outline">{version.riskLevel || 'low'}</Badge>
                              {isDefault ? <Badge variant="secondary">default</Badge> : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              创建：{formatDateTime(version.createdAt)} | 激活：{formatDateTime(version.activatedAt)}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {version.status === 'pending_approval' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={approving}
                                onClick={() => handleApproveVersion(skill.id, version.id)}
                              >
                                {approving ? '审批中...' : '批准版本'}
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              disabled={activating}
                              onClick={() => handleActivateVersion(skill.id, version.id)}
                            >
                              {activating ? '激活中...' : '激活并设默认'}
                            </Button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>绑定策略</CardTitle>
          <CardDescription>创建/更新 Skill 绑定，并可查看现有绑定。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3 rounded-lg border border-border/70 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Skill</Label>
                <Select
                  value={bindingSkillId != null ? String(bindingSkillId) : ''}
                  onValueChange={(value) => setBindingSkillId(Number.parseInt(value, 10))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择 Skill" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.map((skill) => (
                      <SelectItem key={skill.id} value={String(skill.id)}>
                        {skill.displayName} ({skill.slug})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Version</Label>
                <Select value={bindingVersionId} onValueChange={setBindingVersionId}>
                  <SelectTrigger>
                    <SelectValue placeholder="default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">default</SelectItem>
                    {versionOptions.map((version) => (
                      <SelectItem key={version.id} value={String(version.id)}>
                        {version.version} ({version.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Scope Type</Label>
                <Select
                  value={bindingScopeType}
                  onValueChange={(value) => {
                    const next = value as ScopeType
                    setBindingScopeType(next)
                    if (next === 'system') {
                      setBindingScopeId('global')
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">system</SelectItem>
                    <SelectItem value="user">user</SelectItem>
                    <SelectItem value="session">session</SelectItem>
                    <SelectItem value="battle_model">battle_model</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Scope ID</Label>
                <Input
                  value={bindingScopeId}
                  onChange={(event) => setBindingScopeId(event.target.value)}
                  placeholder={bindingScopeType === 'system' ? 'global' : '请输入 scopeId'}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Policy JSON</Label>
                <Textarea
                  rows={4}
                  value={bindingPolicyDraft}
                  onChange={(event) => setBindingPolicyDraft(event.target.value)}
                  placeholder='例如：{"approval":"once_per_session"}'
                />
              </div>
              <div className="space-y-1">
                <Label>Overrides JSON</Label>
                <Textarea
                  rows={4}
                  value={bindingOverridesDraft}
                  onChange={(event) => setBindingOverridesDraft(event.target.value)}
                  placeholder='例如：{"web-search":{"scope":"webpage"}}'
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-sm">
                <Switch checked={bindingEnabled} onCheckedChange={(value) => setBindingEnabled(Boolean(value))} />
                <span>启用绑定</span>
              </div>
              <Button onClick={handleUpsertBinding} disabled={bindingSubmitting}>
                {bindingSubmitting ? '保存中...' : '保存绑定'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {bindings.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无绑定。</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Skill</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>启用</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bindings.map((binding) => {
                    const boundSkill = catalog.find((item) => item.id === binding.skillId)
                    return (
                      <TableRow key={binding.id}>
                        <TableCell className="font-mono text-xs">#{binding.id}</TableCell>
                        <TableCell>{binding.skill?.slug || boundSkill?.slug || binding.skillId}</TableCell>
                        <TableCell>
                          {resolveVersionLabel(boundSkill, binding.versionId)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {binding.scopeType}:{binding.scopeId}
                        </TableCell>
                        <TableCell>{binding.enabled ? '是' : '否'}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteBinding(binding.id)}
                          >
                            删除
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default SystemSkillsPage
