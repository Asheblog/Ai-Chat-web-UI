'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import {
  activateSkillVersion,
  approveSkillVersion,
  deleteSkill,
  deleteSkillBinding,
  installSkillFromGithub,
  listSkillApprovals,
  listSkillBindings,
  listSkillCatalog,
  previewSkillUninstall,
  respondSkillApproval,
  upsertSkillBinding,
} from '@/features/skills/api'
import type {
  SkillApprovalRequestItem,
  SkillBindingItem,
  SkillCatalogItem,
  SkillUninstallDependencySource,
  SkillUninstallPreviewData,
  SkillVersionItem,
} from '@/types'
import { SkillApprovalsSection } from './system-skills/SkillApprovalsSection'
import { SkillBindingsSection } from './system-skills/SkillBindingsSection'
import { SkillInstallSection } from './system-skills/SkillInstallSection'
import { SkillVersionSection } from './system-skills/SkillVersionSection'
import { parseDraftJson, type ScopeType } from './system-skills/shared'

type SkillUninstallPreviewState = {
  skillId: number
  skillDisplayName: string
  removedRequirements: string[]
  removablePackages: string[]
  keptByActiveSkills: string[]
  keptByActiveSkillSources: SkillUninstallDependencySource[]
  keptByManual: string[]
}

const ensureStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)),
  )
}

const ensureActiveDependencySources = (value: unknown): SkillUninstallDependencySource[] => {
  if (!Array.isArray(value)) return []

  const normalizeConsumers = (consumers: SkillUninstallDependencySource['consumers']) =>
    [...consumers].sort((a, b) => {
      const skillCompare = a.skillSlug.localeCompare(b.skillSlug)
      if (skillCompare !== 0) return skillCompare
      const versionCompare = a.version.localeCompare(b.version)
      if (versionCompare !== 0) return versionCompare
      return a.requirement.localeCompare(b.requirement)
    })

  const packageMap = new Map<string, SkillUninstallDependencySource['consumers'][number][]>()

  for (const rawSource of value) {
    const source = rawSource as { packageName?: unknown; consumers?: unknown }
    const packageName = typeof source.packageName === 'string' ? source.packageName.trim() : ''
    if (!packageName) continue
    const consumersRaw = Array.isArray(source.consumers) ? source.consumers : []
    const consumers = packageMap.get(packageName) ?? []

    for (const rawConsumer of consumersRaw) {
      const consumer = rawConsumer as {
        skillId?: unknown
        skillSlug?: unknown
        skillDisplayName?: unknown
        versionId?: unknown
        version?: unknown
        requirement?: unknown
      }
      const skillId = Number(consumer.skillId)
      const versionId = Number(consumer.versionId)
      const skillSlug = typeof consumer.skillSlug === 'string' ? consumer.skillSlug.trim() : ''
      const skillDisplayName =
        typeof consumer.skillDisplayName === 'string' ? consumer.skillDisplayName.trim() : ''
      const version = typeof consumer.version === 'string' ? consumer.version.trim() : ''
      const requirement = typeof consumer.requirement === 'string' ? consumer.requirement.trim() : ''
      if (!Number.isFinite(skillId) || !Number.isFinite(versionId) || !skillSlug || !version || !requirement) {
        continue
      }

      consumers.push({
        skillId,
        skillSlug,
        skillDisplayName: skillDisplayName || skillSlug,
        versionId,
        version,
        requirement,
      })
    }

    packageMap.set(packageName, consumers)
  }

  const normalized: SkillUninstallDependencySource[] = []
  for (const [packageName, consumers] of packageMap.entries()) {
    const dedupMap = new Map<string, SkillUninstallDependencySource['consumers'][number]>()
    for (const consumer of consumers) {
      dedupMap.set(`${consumer.skillId}:${consumer.versionId}:${consumer.requirement.toLowerCase()}`, consumer)
    }
    normalized.push({
      packageName,
      consumers: normalizeConsumers(Array.from(dedupMap.values())),
    })
  }

  return normalized.sort((a, b) => a.packageName.localeCompare(b.packageName))
}

const PackageBucket = (props: {
  title: string
  hint: string
  items: string[]
  emptyText: string
  className: string
}) => {
  const { title, hint, items, emptyText, className } = props
  return (
    <div className={`rounded-lg border p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <Badge key={item} variant="secondary" className="font-mono text-xs">
              {item}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

const ActiveSkillSourcesBucket = (props: {
  packageNames: string[]
  sources: SkillUninstallDependencySource[]
}) => {
  const { packageNames, sources } = props
  const sourceMap = new Map(sources.map((item) => [item.packageName, item.consumers]))
  const displayPackages = Array.from(
    new Set([...packageNames, ...sources.map((item) => item.packageName)]),
  ).sort((a, b) => a.localeCompare(b))

  return (
    <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">保留（激活 Skill 占用）</span>
        <Badge variant="outline">{displayPackages.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">这些包仍被其他已激活 Skill 引用，展开可查看具体来源。</p>
      {displayPackages.length === 0 ? (
        <p className="text-xs text-muted-foreground">无此类保留包。</p>
      ) : (
        <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
          {displayPackages.map((packageName) => {
            const consumers = sourceMap.get(packageName) || []
            return (
              <details key={packageName} className="rounded-md border border-emerald-500/25 bg-background/70 px-3 py-2">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="font-mono text-xs">{packageName}</span>
                  <Badge variant="outline" className="text-[11px]">
                    {consumers.length} 条来源
                  </Badge>
                </summary>
                <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
                  {consumers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无来源明细（请刷新后重试）。</p>
                  ) : (
                    consumers.map((consumer) => (
                      <div key={`${consumer.skillId}:${consumer.versionId}:${consumer.requirement}`} className="rounded border border-border/60 bg-muted/20 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="text-[11px]">
                            {consumer.skillDisplayName}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            {consumer.skillSlug}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            v{consumer.version}
                          </Badge>
                        </div>
                        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{consumer.requirement}</p>
                      </div>
                    ))
                  )}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SystemSkillsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [versionActionKey, setVersionActionKey] = useState<string | null>(null)
  const [skillActionKey, setSkillActionKey] = useState<string | null>(null)
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
  const [uninstallPreview, setUninstallPreview] = useState<SkillUninstallPreviewState | null>(null)
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false)

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

  const handleUninstallSkill = async (skillId: number) => {
    const skill = catalog.find((item) => item.id === skillId)
    if (!skill) return

    const previewKey = `plan:${skillId}`
    setSkillActionKey(previewKey)
    let previewData: SkillUninstallPreviewData | null = null
    try {
      const preview = await previewSkillUninstall(skillId)
      if (!preview?.success || !preview.data) {
        throw new Error(preview?.error || '预览失败')
      }
      previewData = preview.data
    } catch (error) {
      toast({
        title: '预览回收计划失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
      setSkillActionKey(null)
      return
    }

    const cleanupPlan = previewData?.cleanupPlan || {}
    setUninstallPreview({
      skillId: skill.id,
      skillDisplayName: skill.displayName,
      removedRequirements: ensureStringList(previewData?.removedRequirements),
      removablePackages: ensureStringList(cleanupPlan?.removablePackages),
      keptByActiveSkills: ensureStringList(cleanupPlan?.keptByActiveSkills),
      keptByActiveSkillSources: ensureActiveDependencySources(cleanupPlan?.keptByActiveSkillSources),
      keptByManual: ensureStringList(cleanupPlan?.keptByManual),
    })
    setUninstallDialogOpen(true)
    setSkillActionKey(null)
  }

  const handleUninstallDialogOpenChange = (open: boolean) => {
    if (!open && uninstallPreview && skillActionKey === `delete:${uninstallPreview.skillId}`) {
      return
    }
    setUninstallDialogOpen(open)
    if (!open) {
      setUninstallPreview(null)
    }
  }

  const handleConfirmUninstall = async () => {
    if (!uninstallPreview) return
    const skillId = uninstallPreview.skillId
    const key = `delete:${skillId}`
    setSkillActionKey(key)
    try {
      const response = await deleteSkill(skillId)
      if (!response?.success) {
        throw new Error(response?.error || '卸载失败')
      }

      const removedPackages = Array.isArray((response.data as any)?.pythonCleanup?.removedPackages)
        ? (response.data as any).pythonCleanup.removedPackages.length
        : 0
      const cleanupError = (response.data as any)?.pythonCleanup?.error
      if (cleanupError) {
        toast({
          title: 'Skill 已卸载，依赖回收有告警',
          description: String(cleanupError),
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Skill 已卸载',
          description: removedPackages > 0 ? `已自动回收 ${removedPackages} 个 Python 包` : '没有需要回收的 Python 包',
        })
      }
      setUninstallDialogOpen(false)
      setUninstallPreview(null)
      await refreshAll(false)
    } catch (error) {
      toast({
        title: '卸载 Skill 失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      })
    } finally {
      setSkillActionKey(null)
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

  const handleBindingScopeTypeChange = (value: ScopeType) => {
    setBindingScopeType(value)
    if (value === 'system') {
      setBindingScopeId('global')
    }
  }

  const versionOptions: SkillVersionItem[] = selectedSkill?.versions || []

  return (
    <div className="space-y-6 min-w-0">
      <SkillInstallSection
        installSource={installSource}
        installToken={installToken}
        installing={installing}
        refreshing={refreshing}
        onInstallSourceChange={setInstallSource}
        onInstallTokenChange={setInstallToken}
        onInstall={handleInstall}
        onRefresh={() => void refreshAll(false)}
      />

      <SkillApprovalsSection
        loading={loading}
        approvals={approvals}
        approvalActionId={approvalActionId}
        onRespondApproval={handleRespondApproval}
      />

      <SkillVersionSection
        loading={loading}
        catalog={catalog}
        versionActionKey={versionActionKey}
        skillActionKey={skillActionKey}
        onApproveVersion={handleApproveVersion}
        onActivateVersion={handleActivateVersion}
        onUninstallSkill={handleUninstallSkill}
      />

      <SkillBindingsSection
        catalog={catalog}
        bindings={bindings}
        versionOptions={versionOptions}
        bindingSkillId={bindingSkillId}
        bindingVersionId={bindingVersionId}
        bindingScopeType={bindingScopeType}
        bindingScopeId={bindingScopeId}
        bindingEnabled={bindingEnabled}
        bindingPolicyDraft={bindingPolicyDraft}
        bindingOverridesDraft={bindingOverridesDraft}
        bindingSubmitting={bindingSubmitting}
        onBindingSkillIdChange={setBindingSkillId}
        onBindingVersionIdChange={setBindingVersionId}
        onBindingScopeTypeChange={handleBindingScopeTypeChange}
        onBindingScopeIdChange={setBindingScopeId}
        onBindingEnabledChange={setBindingEnabled}
        onBindingPolicyDraftChange={setBindingPolicyDraft}
        onBindingOverridesDraftChange={setBindingOverridesDraft}
        onUpsertBinding={handleUpsertBinding}
        onDeleteBinding={handleDeleteBinding}
      />

      <Dialog open={uninstallDialogOpen} onOpenChange={handleUninstallDialogOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-border/60 px-6 py-5">
            <DialogTitle>卸载 Skill 前预览回收计划</DialogTitle>
            <DialogDescription>
              {uninstallPreview
                ? `Skill「${uninstallPreview.skillDisplayName}」将根据当前激活依赖与手动保留清单执行回收。`
                : '加载中'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto px-6 py-4">
            <div className="rounded-lg border border-border/70 bg-card/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Skill 声明依赖</span>
                <Badge variant="outline">{uninstallPreview?.removedRequirements.length || 0}</Badge>
              </div>
              {uninstallPreview?.removedRequirements?.length ? (
                <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
                  {uninstallPreview.removedRequirements.map((requirement) => (
                    <Badge key={requirement} variant="secondary" className="font-mono text-xs">
                      {requirement}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">该 Skill 未声明 Python 依赖。</p>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <PackageBucket
                title="将自动删除"
                hint="这些包未被其他激活 Skill 和手动保留清单引用。"
                items={uninstallPreview?.removablePackages || []}
                emptyText="无可删除包。"
                className="border-destructive/40 bg-destructive/5"
              />
              <ActiveSkillSourcesBucket
                packageNames={uninstallPreview?.keptByActiveSkills || []}
                sources={uninstallPreview?.keptByActiveSkillSources || []}
              />
              <PackageBucket
                title="保留（手动保留清单）"
                hint="这些包在 Python 运行环境中被标记为手动保留。"
                items={uninstallPreview?.keptByManual || []}
                emptyText="无此类保留包。"
                className="border-amber-500/35 bg-amber-500/5"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border/60 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleUninstallDialogOpenChange(false)}
              disabled={Boolean(uninstallPreview && skillActionKey === `delete:${uninstallPreview.skillId}`)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmUninstall}
              disabled={Boolean(
                !uninstallPreview || skillActionKey === `delete:${uninstallPreview?.skillId || 0}`,
              )}
            >
              {uninstallPreview && skillActionKey === `delete:${uninstallPreview.skillId}` ? '卸载中...' : '确认卸载 Skill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default SystemSkillsPage
