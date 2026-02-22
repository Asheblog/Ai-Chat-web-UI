'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { SkillApprovalRequestItem, SkillBindingItem, SkillCatalogItem, SkillVersionItem } from '@/types'
import { SkillApprovalsSection } from './system-skills/SkillApprovalsSection'
import { SkillBindingsSection } from './system-skills/SkillBindingsSection'
import { SkillInstallSection } from './system-skills/SkillInstallSection'
import { SkillVersionSection } from './system-skills/SkillVersionSection'
import { parseDraftJson, type ScopeType } from './system-skills/shared'

const summarizeList = (items: string[], limit = 8): string => {
  if (!Array.isArray(items) || items.length === 0) return '无'
  const head = items.slice(0, limit)
  const suffix = items.length > limit ? ` ...（+${items.length - limit}）` : ''
  return `${head.join(', ')}${suffix}`
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
    let previewData: any = null
    try {
      const preview = await previewSkillUninstall(skillId)
      if (!preview?.success) {
        throw new Error(preview?.error || '预览失败')
      }
      previewData = preview?.data || {}
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
    const removablePackages = Array.isArray(cleanupPlan?.removablePackages) ? cleanupPlan.removablePackages : []
    const keptByActiveSkills = Array.isArray(cleanupPlan?.keptByActiveSkills) ? cleanupPlan.keptByActiveSkills : []
    const keptByManual = Array.isArray(cleanupPlan?.keptByManual) ? cleanupPlan.keptByManual : []
    const removedRequirements = Array.isArray(previewData?.removedRequirements) ? previewData.removedRequirements : []

    const confirmMessage = [
      `确认卸载 Skill「${skill.displayName}」？`,
      '',
      `依赖声明：${summarizeList(removedRequirements)}`,
      `将自动删除包：${summarizeList(removablePackages)}`,
      `保留（被其他激活 Skill 依赖）：${summarizeList(keptByActiveSkills)}`,
      `保留（手动保留依赖）：${summarizeList(keptByManual)}`,
      '',
      '继续将执行真实卸载。',
    ].join('\n')

    const confirmed = typeof window === 'undefined' ? true : window.confirm(confirmMessage)
    if (!confirmed) {
      setSkillActionKey(null)
      return
    }

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
    </div>
  )
}

export default SystemSkillsPage
