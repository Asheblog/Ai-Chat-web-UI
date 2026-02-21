"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { BookOpen, Cpu, Settings2, ShieldCheck } from "lucide-react"
import { cn } from "@/lib/utils"
import { SystemGeneralPage } from "@/features/settings/pages/system-general"
import { SystemModelsPage } from "@/features/settings/pages/system-models"
import { SystemNetworkPage } from "@/components/settings/pages/SystemNetwork"
import { SystemReasoningPage } from "@/components/settings/pages/SystemReasoning"
import { SystemWebSearchPage } from "@/components/settings/pages/SystemWebSearch"
import { SystemRAGPage } from "@/components/settings/pages/SystemRAG"
import { SystemKnowledgeBasePage } from "@/components/settings/pages/SystemKnowledgeBase"
import { SystemConnectionsPage } from "@/components/settings/pages/SystemConnections"
import { SystemSkillsPage } from "@/components/settings/pages/SystemSkills"
import { SystemSkillAuditsPage } from "@/components/settings/pages/SystemSkillAudits"
import { SystemUsersPage } from "@/components/settings/pages/SystemUsers"
import { SystemModelAccessPage } from "@/components/settings/pages/SystemModelAccess"
import { SystemMonitoringPage } from "@/components/settings/pages/SystemMonitoring"

type WorkspaceModule = {
  key: string
  label: string
  description: string
  content: ReactNode
}

type WorkspaceGroup = {
  key: string
  label: string
  description: string
  icon: typeof Settings2
  modules: WorkspaceModule[]
}

const GROUP_STORAGE_KEY = "settings:system:group"
const MODULE_STORAGE_PREFIX = "settings:system:module:"
const moduleStorageKey = (groupKey: string) => `${MODULE_STORAGE_PREFIX}${groupKey}`

const WORKSPACE_GROUPS: WorkspaceGroup[] = [
  {
    key: "foundation",
    label: "基础运行",
    description: "控制系统行为基线、联网策略和推理流式参数。",
    icon: Settings2,
    modules: [
      {
        key: "foundation.general",
        label: "通用与品牌",
        description: "注册策略、配额、品牌文案、保留策略与标题总结配置。",
        content: <SystemGeneralPage />,
      },
      {
        key: "foundation.network",
        label: "网络与超时",
        description: "SSE 心跳、上游超时、keepalive 与 usage 推送策略。",
        content: <SystemNetworkPage />,
      },
      {
        key: "foundation.reasoning",
        label: "推理链",
        description: "推理可见性、标签模式、flush 间隔与供应商推理参数。",
        content: <SystemReasoningPage />,
      },
      {
        key: "foundation.web-search",
        label: "联网搜索",
        description: "搜索引擎、域名过滤、摘要策略与 Python 工具执行限制。",
        content: <SystemWebSearchPage />,
      },
    ],
  },
  {
    key: "models-tools",
    label: "模型与工具",
    description: "统一管理连接、模型能力、访问策略和 Skill 生命周期。",
    icon: Cpu,
    modules: [
      {
        key: "models-tools.connections",
        label: "连接管理",
        description: "维护 Provider 连接、认证方式、能力标签与连通性验证。",
        content: <SystemConnectionsPage />,
      },
      {
        key: "models-tools.models",
        label: "模型管理",
        description: "模型覆写、能力开关、批量导入导出和参数调优。",
        content: <SystemModelsPage />,
      },
      {
        key: "models-tools.model-access",
        label: "模型权限",
        description: "匿名/注册用户默认策略与单模型访问覆写。",
        content: <SystemModelAccessPage />,
      },
      {
        key: "models-tools.skills",
        label: "Skill 管理",
        description: "Skill 安装、版本审批激活、绑定策略与审批队列处理。",
        content: <SystemSkillsPage />,
      },
    ],
  },
  {
    key: "knowledge",
    label: "知识与文档",
    description: "管理解析模型、文档分块、向量化和知识库权限。",
    icon: BookOpen,
    modules: [
      {
        key: "knowledge.rag",
        label: "RAG 解析",
        description: "文档解析流程、Embedding 模型与解析任务维护。",
        content: <SystemRAGPage />,
      },
      {
        key: "knowledge.kb",
        label: "知识库管理",
        description: "知识库创建、文档上传、公开策略与批量删除。",
        content: <SystemKnowledgeBasePage />,
      },
    ],
  },
  {
    key: "governance",
    label: "治理与审计",
    description: "覆盖用户治理、监控日志和 Skill 执行审计。",
    icon: ShieldCheck,
    modules: [
      {
        key: "governance.users",
        label: "用户管理",
        description: "审批注册、角色调整、额度设置与批量状态维护。",
        content: <SystemUsersPage />,
      },
      {
        key: "governance.monitoring",
        label: "日志与监控",
        description: "并发控制、任务追踪、日志策略与保留策略配置。",
        content: <SystemMonitoringPage />,
      },
      {
        key: "governance.skill-audits",
        label: "Skill 审计",
        description: "按执行记录检索 Skill 调用结果、审批状态与错误上下文。",
        content: <SystemSkillAuditsPage />,
      },
    ],
  },
]

const getInitialGroupKey = () => WORKSPACE_GROUPS[0]?.key || ""
const getInitialModuleKey = () => WORKSPACE_GROUPS[0]?.modules[0]?.key || ""

export function SystemSettings() {
  const [activeGroupKey, setActiveGroupKey] = useState<string>(getInitialGroupKey)
  const [activeModuleKey, setActiveModuleKey] = useState<string>(getInitialModuleKey)

  const activeGroup = useMemo(
    () => WORKSPACE_GROUPS.find((group) => group.key === activeGroupKey) || WORKSPACE_GROUPS[0],
    [activeGroupKey],
  )

  const activeModule = useMemo(() => {
    if (!activeGroup) return null
    return activeGroup.modules.find((module) => module.key === activeModuleKey) || activeGroup.modules[0] || null
  }, [activeGroup, activeModuleKey])

  useEffect(() => {
    if (typeof window === "undefined") return
    const savedGroupKey = window.localStorage.getItem(GROUP_STORAGE_KEY)
    const resolvedGroup = WORKSPACE_GROUPS.find((group) => group.key === savedGroupKey) || WORKSPACE_GROUPS[0]
    if (!resolvedGroup) return
    setActiveGroupKey(resolvedGroup.key)
    const savedModuleKey = window.localStorage.getItem(moduleStorageKey(resolvedGroup.key))
    const resolvedModule = resolvedGroup.modules.find((module) => module.key === savedModuleKey) || resolvedGroup.modules[0]
    setActiveModuleKey(resolvedModule?.key || "")
  }, [])

  useEffect(() => {
    if (!activeGroup) return
    if (activeGroup.modules.some((module) => module.key === activeModuleKey)) return
    setActiveModuleKey(activeGroup.modules[0]?.key || "")
  }, [activeGroup, activeModuleKey])

  useEffect(() => {
    if (typeof window === "undefined" || !activeGroupKey) return
    window.localStorage.setItem(GROUP_STORAGE_KEY, activeGroupKey)
  }, [activeGroupKey])

  useEffect(() => {
    if (typeof window === "undefined" || !activeGroup || !activeModule) return
    window.localStorage.setItem(moduleStorageKey(activeGroup.key), activeModule.key)
  }, [activeGroup, activeModule])

  const handleGroupChange = (nextGroupKey: string) => {
    if (nextGroupKey === activeGroupKey) return
    const nextGroup = WORKSPACE_GROUPS.find((group) => group.key === nextGroupKey)
    if (!nextGroup) return
    setActiveGroupKey(nextGroupKey)
    const rememberedModuleKey =
      typeof window !== "undefined" ? window.localStorage.getItem(moduleStorageKey(nextGroupKey)) : null
    const resolvedModule = nextGroup.modules.find((module) => module.key === rememberedModuleKey) || nextGroup.modules[0]
    setActiveModuleKey(resolvedModule?.key || "")
  }

  if (!activeGroup || !activeModule) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/70 p-6 text-sm text-muted-foreground">
        暂无可用的系统设置模块
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-6">
      <section className="rounded-2xl border border-border/80 bg-card/95 p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">System Settings</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">配置中心</h2>
      </section>

      <section className="space-y-4 rounded-2xl border border-border/80 bg-card/80 p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-2">
          {WORKSPACE_GROUPS.map((group) => {
            const Icon = group.icon
            const active = group.key === activeGroup.key
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => handleGroupChange(group.key)}
                className={cn(
                  "w-full cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors",
                  active
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/70 bg-[hsl(var(--surface))/0.4] hover:border-primary/40 hover:bg-[hsl(var(--surface-hover))]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="text-sm font-medium">{group.label}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{group.description}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {group.modules.length} 项
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        <div className="overflow-x-auto">
          <div className="flex min-w-max gap-2 pb-1">
            {activeGroup.modules.map((module) => {
              const active = module.key === activeModule.key
              return (
                <button
                  key={module.key}
                  type="button"
                  onClick={() => setActiveModuleKey(module.key)}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "border-primary/70 bg-primary text-primary-foreground"
                      : "border-border/70 bg-[hsl(var(--surface))/0.5] text-foreground hover:bg-[hsl(var(--surface-hover))]",
                  )}
                >
                  {module.label}
                </button>
              )
            })}
          </div>
        </div>

        <p className="text-sm text-muted-foreground">{activeModule.description}</p>
      </section>

      <section key={activeModule.key} className="min-w-0">
        {activeModule.content}
      </section>
    </div>
  )
}

export default SystemSettings
