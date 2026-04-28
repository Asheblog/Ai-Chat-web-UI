"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import {
  BookOpen,
  Boxes,
  Cloud,
  ClipboardList,
  Database,
  Globe,
  KeyRound,
  LayoutDashboard,
  PlugZap,
  Puzzle,
  Router,
  ScrollText,
  Settings2,
  Terminal,
  Users,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"

const pageLoading = () => (
  <div className="v2-panel-soft p-6 text-sm text-muted-foreground">
    正在加载设置模块...
  </div>
)

const SystemGeneralPage = dynamic(
  () => import("@/features/settings/pages/system-general").then((m) => m.SystemGeneralPage),
  { loading: pageLoading },
)
const SystemModelsPage = dynamic(
  () => import("@/features/settings/pages/system-models").then((m) => m.SystemModelsPage),
  { loading: pageLoading },
)
const SystemNetworkPage = dynamic(
  () => import("@/components/settings/pages/SystemNetwork").then((m) => m.SystemNetworkPage),
  { loading: pageLoading },
)
const SystemReasoningPage = dynamic(
  () => import("@/components/settings/pages/SystemReasoning").then((m) => m.SystemReasoningPage),
  { loading: pageLoading },
)
const SystemConnectionsPage = dynamic(
  () => import("@/components/settings/pages/SystemConnections").then((m) => m.SystemConnectionsPage),
  { loading: pageLoading },
)
const SystemSkillsPage = dynamic(
  () => import("@/components/settings/pages/SystemSkills").then((m) => m.SystemSkillsPage),
  { loading: pageLoading },
)
const SystemSkillAuditsPage = dynamic(
  () => import("@/components/settings/pages/SystemSkillAudits").then((m) => m.SystemSkillAuditsPage),
  { loading: pageLoading },
)
const SystemUsersPage = dynamic(
  () => import("@/components/settings/pages/SystemUsers").then((m) => m.SystemUsersPage),
  { loading: pageLoading },
)
const SystemModelAccessPage = dynamic(
  () => import("@/components/settings/pages/SystemModelAccess").then((m) => m.SystemModelAccessPage),
  { loading: pageLoading },
)
const SystemMonitoringPage = dynamic(
  () => import("@/components/settings/pages/SystemMonitoring").then((m) => m.SystemMonitoringPage),
  { loading: pageLoading },
)
const SystemWebSearchPage = dynamic(
  () => import("@/components/settings/pages/SystemWebSearch").then((m) => m.SystemWebSearchPage),
  { loading: pageLoading },
)
const SystemRAGPage = dynamic(
  () => import("@/components/settings/pages/SystemRAG").then((m) => m.SystemRAGPage),
  { loading: pageLoading },
)
const SystemKnowledgeBasePage = dynamic(
  () => import("@/components/settings/pages/SystemKnowledgeBase").then((m) => m.SystemKnowledgeBasePage),
  { loading: pageLoading },
)
const LogViewerPage = dynamic(
  () => import("@/components/settings/pages/LogViewerPage").then((m) => m.LogViewerPage),
  { loading: pageLoading },
)
const SystemPythonRuntimePage = dynamic(
  () => import("@/components/settings/pages/SystemPythonRuntime").then((m) => m.SystemPythonRuntimePage),
  { loading: pageLoading },
)

function ModuleSubTabs({
  tabs,
  activeKey,
  onSelect,
}: {
  tabs: { key: string; label: string; icon: ReactNode }[]
  activeKey: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-5">
      {tabs.map((tab) => {
        const active = tab.key === activeKey
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelect(tab.key)}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-[7px] border px-3 text-xs font-medium transition-colors",
              active
                ? "border-primary/80 bg-primary/10 text-primary"
                : "border-slate-200 bg-white/70 text-slate-500 hover:bg-slate-50 hover:text-slate-800",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function KnowledgeDocsModule() {
  const [sub, setSub] = useState("rag")

  const subTabs = [
    { key: "rag", label: "RAG 文档解析", icon: <Database className="h-3.5 w-3.5" /> },
    { key: "knowledge-base", label: "知识库管理", icon: <BookOpen className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="min-w-0">
      <ModuleSubTabs tabs={subTabs} activeKey={sub} onSelect={setSub} />
      {sub === "rag" ? <SystemRAGPage /> : <SystemKnowledgeBasePage />}
    </div>
  )
}

function ToolsRuntimeModule() {
  const [sub, setSub] = useState("web-search")

  const subTabs = [
    { key: "web-search", label: "联网搜索", icon: <Globe className="h-3.5 w-3.5" /> },
    { key: "python-runtime", label: "Python 运行时", icon: <Terminal className="h-3.5 w-3.5" /> },
  ]

  return (
    <div className="min-w-0">
      <ModuleSubTabs tabs={subTabs} activeKey={sub} onSelect={setSub} />
      {sub === "web-search" ? <SystemWebSearchPage /> : <SystemPythonRuntimePage />}
    </div>
  )
}

type SystemModule = {
  key: string
  label: string
  description: string
  icon: typeof Settings2
  content: ReactNode
  topLevel?: boolean
}

const MODULE_STORAGE_KEY = "settings:system:v2-module"

const SYSTEM_MODULES: SystemModule[] = [
  {
    key: "overview",
    label: "概览",
    description: "查看模型、连接、权限与审计的运行概况。",
    icon: LayoutDashboard,
    content: <SystemOverviewContent />,
  },
  {
    key: "models",
    label: "模型管理",
    description: "维护模型目录、上下文、生成 Tokens 与能力覆写。",
    icon: Boxes,
    content: <SystemModelsPage />,
    topLevel: true,
  },
  {
    key: "connections",
    label: "连接管理",
    description: "管理 Provider、API Key、健康状态与连接详情。",
    icon: PlugZap,
    content: <SystemConnectionsPage />,
    topLevel: true,
  },
  {
    key: "api-routing",
    label: "API 路由",
    description: "设置匿名/注册用户的模型访问策略与路由覆写。",
    icon: Router,
    content: <SystemModelAccessPage />,
    topLevel: true,
  },
  {
    key: "token-management",
    label: "令牌管理",
    description: "配置推理输出 Tokens、安装 Token 与相关能力开关。",
    icon: KeyRound,
    content: <SystemReasoningPage />,
    topLevel: true,
  },
  {
    key: "members",
    label: "成员与权限",
    description: "审批注册、调整角色、设置额度与维护账号状态。",
    icon: Users,
    content: <SystemUsersPage />,
  },
  {
    key: "audit",
    label: "审计日志",
    description: "检索 Skill 执行审计、任务追踪与运行日志。",
    icon: ClipboardList,
    content: <SystemSkillAuditsPage />,
  },
  {
    key: "system-config",
    label: "系统配置",
    description: "配置注册策略、品牌、配额、网络和运行基线。",
    icon: Settings2,
    content: <SystemGeneralPage />,
    topLevel: true,
  },
  {
    key: "backup",
    label: "备份与恢复",
    description: "查看任务监控、保留策略与恢复相关运行状态。",
    icon: Cloud,
    content: <SystemMonitoringPage />,
  },
  {
    key: "network",
    label: "网络与超时",
    description: "调整 SSE 心跳、上游超时与 usage 推送策略。",
    icon: Router,
    content: <SystemNetworkPage />,
  },
  {
    key: "knowledge-docs",
    label: "知识库与文档",
    description: "管理 RAG 文档解析参数与知识库文档和公开访问权限。",
    icon: BookOpen,
    content: <KnowledgeDocsModule />,
    topLevel: true,
  },
  {
    key: "tools-runtime",
    label: "工具与运行时",
    description: "配置联网搜索引擎、Python 运行环境和工具调用策略。",
    icon: Wrench,
    content: <ToolsRuntimeModule />,
    topLevel: true,
  },
  {
    key: "logs",
    label: "日志查看器",
    description: "按级别与模块检索系统运行日志与上下文。",
    icon: ScrollText,
    content: <LogViewerPage />,
    topLevel: true,
  },
  {
    key: "skills",
    label: "Skill 管理",
    description: "安装、审批、激活 Skill 并维护绑定策略。",
    icon: Puzzle,
    content: <SystemSkillsPage />,
  },
]

const TOP_MODULES = SYSTEM_MODULES.filter((module) => module.topLevel)
const getModuleByKey = (key?: string | null) =>
  SYSTEM_MODULES.find((module) => module.key === key) ||
  SYSTEM_MODULES.find((module) => module.key === "connections") ||
  SYSTEM_MODULES[0]

function emitActiveModule(key: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("aichat:system-settings-active", { detail: { key } }))
}

export function SystemSettings() {
  const [activeModuleKey, setActiveModuleKey] = useState("connections")

  const activeModule = useMemo(() => getModuleByKey(activeModuleKey), [activeModuleKey])

  const selectModule = (key: string) => {
    const next = getModuleByKey(key)
    if (!next) return
    setActiveModuleKey(next.key)
    emitActiveModule(next.key)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODULE_STORAGE_KEY, next.key)
      document.getElementById("settings-system-workspace")?.scrollTo({ top: 0, behavior: "smooth" })
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    const savedKey = window.localStorage.getItem(MODULE_STORAGE_KEY)
    const initial = getModuleByKey(savedKey)
    if (initial) {
      setActiveModuleKey(initial.key)
      emitActiveModule(initial.key)
    }

    const onExternalSelect = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail
      if (detail?.key) {
        selectModule(detail.key)
      }
    }
    window.addEventListener("aichat:system-settings-select", onExternalSelect as EventListener)
    return () => {
      window.removeEventListener("aichat:system-settings-select", onExternalSelect as EventListener)
    }
    // selectModule intentionally stays inline so the listener always uses current helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!activeModule) {
    return (
      <div className="v2-panel-soft p-6 text-sm text-muted-foreground">
        暂无可用的系统设置模块
      </div>
    )
  }

  return (
    <div id="settings-system-workspace" className="min-w-0 space-y-5">
      <section className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">配置中心</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            集中管理模型、连接、路由、令牌和系统运行策略。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {TOP_MODULES.map((module) => {
            const Icon = module.icon
            const active = module.key === activeModule.key
            return (
              <button
                key={module.key}
                type="button"
                onClick={() => selectModule(module.key)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-[8px] border px-4 text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-[0_10px_22px_rgba(37,99,235,0.18)]"
                    : "border-slate-200 bg-white/80 text-slate-600 hover:bg-blue-50 hover:text-slate-950",
                )}
              >
                <Icon className="h-4 w-4" />
                {module.label}
              </button>
            )
          })}
        </div>
      </section>

      <section key={activeModule.key} className="min-w-0">
        {activeModule.content}
      </section>
    </div>
  )
}

function SystemOverviewContent() {
  const overviewItems = [
    { label: "模型管理", value: "目录与能力", tone: "text-blue-600" },
    { label: "连接管理", value: "Provider / Key", tone: "text-emerald-600" },
    { label: "成员与权限", value: "角色 / 额度", tone: "text-violet-600" },
    { label: "审计日志", value: "Skill / 任务", tone: "text-amber-600" },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {overviewItems.map((item) => (
        <div key={item.label} className="v2-panel bg-white/90 p-5">
          <div className="text-sm font-medium text-slate-500">{item.label}</div>
          <div className={cn("mt-3 text-lg font-semibold", item.tone)}>{item.value}</div>
          <div className="mt-2 text-xs text-slate-500">从左侧系统设置进入对应工作区。</div>
        </div>
      ))}
    </div>
  )
}

export default SystemSettings
