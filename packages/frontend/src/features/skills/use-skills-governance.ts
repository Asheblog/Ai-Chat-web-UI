"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import {
  activateSkillVersion,
  approveSkillVersion,
  deleteSkill,
  deleteSkillBinding,
  listSkillApprovals,
  listSkillBindings,
  listSkillCatalog,
  previewSkillUninstall,
  respondSkillApproval,
  upsertSkillBinding,
} from "@/features/skills/api"
import type {
  SkillApprovalRequestItem,
  SkillBindingItem,
  SkillCatalogItem,
} from "@/types"
import {
  ensureActiveDependencySources,
  ensureStringList,
  type SkillUninstallPreviewState,
} from "./uninstall-preview"

/**
 * Skill 治理逻辑：原 `SkillsGovernancePage` 的页面层逻辑整体搬迁，行为未改。
 * 返回三路数据、各动作 busy key、绑定草稿组、卸载预览状态与全部动作（含 refreshAll）。
 */

/** 绑定表单的 JSON 草稿：空串视为 {}，非对象抛错（文案与改前一致）。 */
const parseDraftJson = (value: string, fieldName: string) => {
  const trimmed = value.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象`)
  }
  return parsed as Record<string, unknown>
}

/** deleteSkill 响应里的附加字段：只在存在时读，缺失按无回收处理。 */
type PythonCleanupSummary = { pythonCleanup?: { removedPackages?: unknown; error?: unknown } | null }

export function useSkillsGovernance() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [versionActionKey, setVersionActionKey] = useState<string | null>(null)
  const [skillActionKey, setSkillActionKey] = useState<string | null>(null)
  const [bindingSubmitting, setBindingSubmitting] = useState(false)
  const [approvalActionId, setApprovalActionId] = useState<number | null>(null)
  const [catalog, setCatalog] = useState<SkillCatalogItem[]>([])
  const [bindings, setBindings] = useState<SkillBindingItem[]>([])
  const [approvals, setApprovals] = useState<SkillApprovalRequestItem[]>([])
  const [bindingSkillId, setBindingSkillId] = useState<number | null>(null)
  const [bindingVersionId, setBindingVersionId] = useState<string>("default")
  const [bindingScopeType, setBindingScopeType] = useState<SkillBindingItem["scopeType"]>("system")
  const [bindingScopeId, setBindingScopeId] = useState("global")
  const [bindingEnabled, setBindingEnabled] = useState(true)
  const [bindingPolicyDraft, setBindingPolicyDraft] = useState("")
  const [bindingOverridesDraft, setBindingOverridesDraft] = useState("")
  const [uninstallPreview, setUninstallPreview] = useState<SkillUninstallPreviewState | null>(null)
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false)

  const selectedSkill = useMemo(() => catalog.find((item) => item.id === bindingSkillId) || null, [catalog, bindingSkillId])

  const toastFailure = (title: string, error: unknown) =>
    toast({
      title,
      description: error instanceof Error ? error.message : "未知错误",
      variant: "destructive",
    })

  const refreshAll = useCallback(
    async (initial = false) => {
      if (initial) setLoading(true)
      try {
        const [catalogResponse, bindingsResponse, approvalsResponse] = await Promise.all([
          listSkillCatalog({ all: true, includeVersions: true }),
          listSkillBindings(),
          listSkillApprovals({ status: "pending", limit: 100 }),
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
        toastFailure("加载 Skill 数据失败", error)
      } finally {
        if (initial) setLoading(false)
      }
    },
    // toast 稳定；toastFailure 只是它的薄包装，故依赖仅列 toast
    [toast],
  )

  useEffect(() => {
    refreshAll(true)
  }, [refreshAll])

  const approveVersion = async (skillId: number, versionId: number) => {
    setVersionActionKey(`approve:${skillId}:${versionId}`)
    try {
      const response = await approveSkillVersion(skillId, versionId)
      if (!response?.success) throw new Error(response?.error || "审批失败")
      toast({ title: "版本审批成功" })
      await refreshAll(false)
    } catch (error) {
      toastFailure("版本审批失败", error)
    } finally {
      setVersionActionKey(null)
    }
  }
  const activateVersion = async (skillId: number, versionId: number) => {
    setVersionActionKey(`activate:${skillId}:${versionId}`)
    try {
      const response = await activateSkillVersion(skillId, versionId, { makeDefault: true })
      if (!response?.success) throw new Error(response?.error || "激活失败")
      toast({ title: "版本已激活并设为默认" })
      await refreshAll(false)
    } catch (error) {
      toastFailure("版本激活失败", error)
    } finally {
      setVersionActionKey(null)
    }
  }

  const requestUninstall = async (skillId: number) => {
    const skill = catalog.find((item) => item.id === skillId)
    if (!skill) return
    setSkillActionKey(`plan:${skillId}`)
    try {
      const preview = await previewSkillUninstall(skillId)
      if (!preview?.success || !preview.data) throw new Error(preview?.error || "预览失败")
      const cleanupPlan = preview.data.cleanupPlan || {}
      setUninstallPreview({
        skillId: skill.id,
        skillDisplayName: skill.displayName,
        removedRequirements: ensureStringList(preview.data.removedRequirements),
        removablePackages: ensureStringList(cleanupPlan?.removablePackages),
        keptByActiveSkills: ensureStringList(cleanupPlan?.keptByActiveSkills),
        keptByActiveSkillSources: ensureActiveDependencySources(cleanupPlan?.keptByActiveSkillSources),
        keptByManual: ensureStringList(cleanupPlan?.keptByManual),
      })
      setUninstallDialogOpen(true)
    } catch (error) {
      toastFailure("预览回收计划失败", error)
    } finally {
      setSkillActionKey(null)
    }
  }

  const handleUninstallDialogOpenChange = (open: boolean) => {
    if (!open && uninstallPreview && skillActionKey === `delete:${uninstallPreview.skillId}`) return
    setUninstallDialogOpen(open)
    if (!open) setUninstallPreview(null)
  }

  const confirmUninstall = async () => {
    if (!uninstallPreview) return
    const skillId = uninstallPreview.skillId
    setSkillActionKey(`delete:${skillId}`)
    try {
      const response = await deleteSkill(skillId)
      if (!response?.success) throw new Error(response?.error || "卸载失败")
      // pythonCleanup 是后端附加字段：只在存在时读，缺失按 0 个包处理
      const cleanup = (response.data as PythonCleanupSummary | undefined)?.pythonCleanup
      const removedPackages = Array.isArray(cleanup?.removedPackages) ? cleanup.removedPackages.length : 0
      if (cleanup?.error) {
        toast({
          title: "Skill 已卸载，依赖回收有告警",
          description: String(cleanup.error),
          variant: "destructive",
        })
      } else {
        toast({
          title: "Skill 已卸载",
          description:
            removedPackages > 0 ? `已自动回收 ${removedPackages} 个 Python 包` : "没有需要回收的 Python 包",
        })
      }
      setUninstallDialogOpen(false)
      setUninstallPreview(null)
      await refreshAll(false)
    } catch (error) {
      toastFailure("卸载 Skill 失败", error)
    } finally {
      setSkillActionKey(null)
    }
  }

  const upsertBinding = async () => {
    if (!bindingSkillId) return toast({ title: "请先选择 Skill", variant: "destructive" })
    setBindingSubmitting(true)
    try {
      const policy = parseDraftJson(bindingPolicyDraft, "策略 JSON")
      const overrides = parseDraftJson(bindingOverridesDraft, "覆盖配置 JSON")
      const versionId = bindingVersionId === "default" ? null : Number.parseInt(bindingVersionId, 10)
      const response = await upsertSkillBinding({
        skillId: bindingSkillId,
        versionId: Number.isFinite(versionId) ? versionId : null,
        scopeType: bindingScopeType,
        scopeId: bindingScopeId.trim() || "global",
        enabled: bindingEnabled,
        policy,
        overrides,
      })
      if (!response?.success) throw new Error(response?.error || "绑定失败")
      toast({ title: "绑定已保存" })
      await refreshAll(false)
    } catch (error) {
      toastFailure("保存绑定失败", error)
    } finally {
      setBindingSubmitting(false)
    }
  }

  const deleteBinding = async (bindingId: number) => {
    try {
      const response = await deleteSkillBinding(bindingId)
      if (!response?.success) throw new Error(response?.error || "删除失败")
      toast({ title: "绑定已删除" })
      setBindings((prev) => prev.filter((item) => item.id !== bindingId))
    } catch (error) {
      toastFailure("删除绑定失败", error)
    }
  }

  const respondApproval = async (requestId: number, approved: boolean) => {
    setApprovalActionId(requestId)
    try {
      const response = await respondSkillApproval(requestId, { approved })
      if (!response?.success) throw new Error(response?.error || "处理失败")
      toast({ title: approved ? "审批已通过" : "审批已拒绝" })
      setApprovals((prev) => prev.filter((item) => item.id !== requestId))
    } catch (error) {
      toastFailure("审批处理失败", error)
    } finally {
      setApprovalActionId(null)
    }
  }

  const handleBindingScopeTypeChange = (value: SkillBindingItem["scopeType"]) => {
    setBindingScopeType(value)
    if (value === "system") setBindingScopeId("global")
  }

  return {
    loading,
    catalog,
    bindings,
    approvals,
    versionActionKey,
    skillActionKey,
    approvalActionId,
    bindingSubmitting,
    binding: {
      skillId: bindingSkillId,
      versionId: bindingVersionId,
      scopeType: bindingScopeType,
      scopeId: bindingScopeId,
      enabled: bindingEnabled,
      policyDraft: bindingPolicyDraft,
      overridesDraft: bindingOverridesDraft,
      versionOptions: selectedSkill?.versions || [],
    },
    uninstall: { preview: uninstallPreview, dialogOpen: uninstallDialogOpen },
    actions: {
      approveVersion,
      activateVersion,
      requestUninstall,
      confirmUninstall,
      upsertBinding,
      deleteBinding,
      respondApproval,
      refreshAll,
      setBindingSkillId,
      setBindingVersionId,
      setBindingScopeType: handleBindingScopeTypeChange,
      setBindingScopeId,
      setBindingEnabled,
      setBindingPolicyDraft,
      setBindingOverridesDraft,
      setUninstallDialogOpen: handleUninstallDialogOpenChange,
    },
  }
}
