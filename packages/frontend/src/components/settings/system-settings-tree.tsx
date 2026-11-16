import {
  BrainCircuit,
  Boxes,
  Cable,
  Database,
  HardDrive,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Palette,
  PlugZap,
  ScrollText,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react"

/**
 * 系统设置的纯数据层：导航树、卡片索引与位置描述。
 *
 * 这里刻意不 import 任何 React 组件或页面 —— 组件侧（system-settings-registry）反向依赖本模块，
 * 概览页也要读导航树；数据与组件放在同一文件会形成
 * registry → overview → registry 的循环 import（architecture:check 会失败）。
 */

// Leaf metadata

export type SystemLeafMeta = {
  key: string
  label: string
  icon: LucideIcon
  keywords?: string[]
  /** 一句话说明，用于概览入口卡（不参与搜索索引）。 */
  summary?: string
}

export type SystemWorkspaceNode = {
  key: string
  label: string
  icon: LucideIcon
  children: SystemLeafMeta[]
  /** 一句话说明，用于概览入口卡（不参与搜索索引）。 */
  summary?: string
}

/** Top-level system settings entry: either a leaf or a workspace group. */
export type SystemSettingsEntry = SystemLeafMeta | SystemWorkspaceNode

/** 叶子页内可定位的功能卡元数据（FeatureCard 或等价的固定区块）。 */
export type SystemCardMeta = {
  /** 所属叶子页 key（systemSettingsTree 叶子） */
  leafKey: string
  /** 全局唯一卡 key，形如 "leafKey:cardKey" */
  key: string
  /** 卡显示名，如 "上下文压缩" */
  label: string
  /** 搜索补充词 */
  keywords?: string[]
}

// Navigation tree: 概览（入口状态摘要）+ 6 组导航。
// 多叶子分组保留二级条目；只有一个关注点的分组拍平为顶级叶子，旧叶子 key 全部不变，
// 因此 localStorage 里保存的旧模块、深链与浏览器返回都不会失效。
// 叶子 key 顺序 = 导航渲染顺序。

export const systemSettingsTree: SystemSettingsEntry[] = [
  {
    key: "overview",
    label: "概览",
    icon: LayoutDashboard,
    keywords: ["首页", "状态摘要", "部署状态"],
    summary: "入口状态摘要",
  },
  {
    key: "model-connections",
    label: "连接与模型",
    icon: Cable,
    summary: "供应商连接、模型目录与生成参数、会话默认提示词",
    children: [
      {
        key: "connections",
        label: "供应商与连接",
        icon: PlugZap,
        keywords: ["provider", "API Key", "openai", "google", "deepseek", "密钥", "凭据"],
      },
      { key: "models", label: "模型管理", icon: Boxes, keywords: ["模型权限", "能力", "访问控制", "生成参数"] },
      {
        key: "session-defaults",
        label: "会话默认配置",
        icon: MessageSquare,
        keywords: ["系统提示词", "chatSystemPrompt", "会话", "提示词", "继承"],
      },
    ],
  },
  {
    key: "search-knowledge",
    label: "搜索与知识库",
    icon: Search,
    summary: "联网搜索引擎、知识库与文档解析（含 Embedding）",
    keywords: ["联网搜索", "web search", "RAG", "知识库", "嵌入", "Embedding"],
  },
  {
    key: "extensions",
    label: "工具与扩展",
    icon: Layers,
    summary: "MCP 服务、Skill、Python 工具与扩展安装权限",
    keywords: [
      "MCP",
      "模型上下文协议",
      "Skill",
      "Python",
      "扩展",
      "工具",
      "审批",
      "绑定",
      "凭据",
      "安装",
      "大乱斗",
      "标题",
    ],
  },
  {
    key: "users-registration",
    label: "用户与访问",
    icon: Users,
    summary: "注册审批、账号状态、角色与每日额度",
    keywords: ["成员", "注册", "配额", "额度", "访问"],
  },
  {
    key: "data-logs",
    label: "数据与日志",
    icon: Database,
    summary: "保留策略、上下文压缩、并发、系统日志与任务追踪",
    children: [
      {
        key: "data-maintenance",
        label: "数据与维护",
        icon: HardDrive,
        keywords: ["备份", "保留", "压缩", "并发", "监控"],
      },
      {
        key: "logs-audit",
        label: "日志与审计",
        icon: ScrollText,
        keywords: ["审计", "任务追踪", "运行日志", "日志"],
      },
      {
        key: "reasoning-network",
        label: "生成与网络（高级）",
        icon: BrainCircuit,
        keywords: ["推理", "推理强度", "token", "生成上限", "流式", "网络", "超时", "保活", "高级"],
      },
    ],
  },
  {
    key: "branding",
    label: "外观与站点",
    icon: Palette,
    summary: "品牌名、AI 头像、站点访问地址与主题配色",
    keywords: ["品牌", "头像", "站点", "siteBaseUrl", "主题配色"],
  },
]

// Card-level registry: searchable/locatable blocks inside leaf pages.
// Keys follow "leafKey:cardKey"; values mirror the cards rendered by each
// leaf page (FeatureCard title, or equivalent fixed section heading).

export const systemSettingsCards: SystemCardMeta[] = [
  // 供应商与连接
  { leafKey: "connections", key: "connections:quick-connect", label: "快速接入", keywords: ["模板", "供应商", "密钥", "预填"] },
  { leafKey: "connections", key: "connections:advanced", label: "高级管理", keywords: ["连接列表", "Key 池", "导入", "导出", "迁移", "JSON"] },
  // 模型管理
  { leafKey: "models", key: "models:catalog", label: "模型目录与能力", keywords: ["模型列表", "能力", "上下文窗口", "批量开关", "覆写"] },
  { leafKey: "models", key: "models:access", label: "访问控制", keywords: ["默认访问策略", "访问覆写", "匿名", "注册"] },
  // 会话默认配置
  { leafKey: "session-defaults", key: "session-defaults:prompt", label: "全局系统提示词", keywords: ["chatSystemPrompt", "提示词", "会话", "继承", "个人"] },
  // 搜索与知识库
  { leafKey: "search-knowledge", key: "search-knowledge:web-search", label: "联网搜索", keywords: ["web search", "引擎", "API Key", "并行", "白名单", "DeepSeek", "Fetch", "付费回退"] },
  { leafKey: "search-knowledge", key: "search-knowledge:document-knowledge", label: "文档与知识库", keywords: ["RAG", "文档解析", "知识库", "Embedding", "分块", "检索", "TopK", "文档管理", "上传上限", "检索模式"] },
  // 能力扩展 · MCP 服务段
  { leafKey: "extensions", key: "extensions:mcp-installations", label: "MCP 安装模板", keywords: ["模板", "远程", "本地", "服务定义"] },
  { leafKey: "extensions", key: "extensions:mcp-connections", label: "MCP 连接", keywords: ["实例", "工具缓存"] },
  { leafKey: "extensions", key: "extensions:mcp-secrets", label: "MCP 凭据", keywords: ["API 密钥", "secret-vault", "密钥"] },
  { leafKey: "extensions", key: "extensions:mcp-tools", label: "MCP 工具", keywords: ["Schema", "搜索", "固定", "工具清单"] },
  { leafKey: "extensions", key: "extensions:mcp-bindings", label: "MCP 绑定", keywords: ["作用域", "system", "user", "session"] },
  // 能力扩展 · Skill 段
  { leafKey: "extensions", key: "extensions:skill-install", label: "Skill 安装", keywords: ["GitHub", "仓库"] },
  { leafKey: "extensions", key: "extensions:skill-approvals", label: "待审批调用", keywords: ["审批", "待审批"] },
  { leafKey: "extensions", key: "extensions:skill-versions", label: "Skill 版本管理", keywords: ["版本", "激活", "默认", "卸载"] },
  { leafKey: "extensions", key: "extensions:skill-bindings", label: "绑定策略", keywords: ["作用域", "策略 JSON"] },
  // 能力扩展 · 内置工具段 / 对话增强段
  { leafKey: "extensions", key: "extensions:python-tools", label: "Python 工具", keywords: ["沙箱", "代码执行", "迭代上限"] },
  { leafKey: "extensions", key: "extensions:python-runtime", label: "Python 运行时管理", keywords: ["依赖安装", "索引", "Reconcile", "已安装包"] },
  { leafKey: "extensions", key: "extensions:battle", label: "模型大乱斗", keywords: ["乱斗", "每日次数"] },
  { leafKey: "extensions", key: "extensions:title-summary", label: "标题智能总结", keywords: ["对话标题", "模型", "字数"] },
  // 用户与注册
  { leafKey: "users-registration", key: "users-registration:policy", label: "用户注册", keywords: ["注册开放", "访客", "每日额度", "配额"] },
  { leafKey: "users-registration", key: "users-registration:users", label: "用户管理", keywords: ["用户列表", "审批", "账号状态", "角色"] },
  // 外观与站点
  { leafKey: "branding", key: "branding:avatar", label: "AI 头像", keywords: ["上传", "图片"] },
  { leafKey: "branding", key: "branding:branding", label: "品牌与站点", keywords: ["LOGO", "品牌名", "siteBaseUrl", "图片域名", "主题配色", "颜色"] },
  // 数据与维护
  { leafKey: "data-maintenance", key: "data-maintenance:retention", label: "数据保留策略", keywords: ["清理", "天数", "自动清理"] },
  { leafKey: "data-maintenance", key: "data-maintenance:compression", label: "上下文压缩", keywords: ["触发阈值", "保留消息"] },
  { leafKey: "data-maintenance", key: "data-maintenance:concurrency", label: "并发生成控制", keywords: ["并发", "流式", "限制"] },
  { leafKey: "data-maintenance", key: "data-maintenance:task-trace", label: "任务追踪", keywords: ["启用", "保留天数", "心跳告警"] },
  { leafKey: "data-maintenance", key: "data-maintenance:system-log", label: "系统运行日志", keywords: ["日志级别", "文件", "保留天数"] },
  // 生成与网络（高级）
  { leafKey: "reasoning-network", key: "reasoning-network:reasoning", label: "推理与生成", keywords: ["思考过程", "推理强度", "保存", "标签兼容", "温度", "生成上限"] },
  { leafKey: "reasoning-network", key: "reasoning-network:stream", label: "流式与传输", keywords: ["分片", "flush", "Keepalive", "保活"] },
  { leafKey: "reasoning-network", key: "reasoning-network:network", label: "网络与超时", keywords: ["SSE 心跳", "首帧宽限", "思考静默", "超时"] },
]

export const DEFAULT_SYSTEM_LEAF = "overview"

/** 叶子 label 查找（用于卡结果的所属页提示）。 */
export function getLeafLabel(leafKey: string): string | undefined {
  for (const entry of systemSettingsTree) {
    if ("children" in entry) {
      const leaf = entry.children.find((c) => c.key === leafKey)
      if (leaf) return leaf.label
    } else if (entry.key === leafKey) {
      return entry.label
    }
  }
  return undefined
}

/** 卡 label 查找。 */
export function getCardLabel(cardKey: string): string | undefined {
  return systemSettingsCards.find((c) => c.key === cardKey)?.label
}

/**
 * 描述设置项位置：「分组 → 叶子」或「分组 → 叶子 · 卡」。
 * 叶子或卡不存在时返回 null（banner 不显示）。
 */
export function describeSettingsLocation(leafKey: string, cardKey?: string): string | null {
  const workspaceKey = getWorkspaceForLeaf(leafKey)
  const workspaceLabel =
    workspaceKey && workspaceKey !== leafKey
      ? (systemSettingsTree.find((e) => e.key === workspaceKey) as SystemWorkspaceNode | undefined)?.label
      : undefined
  const leafLabel = getLeafLabel(leafKey)
  if (!leafLabel) return null

  let path = workspaceLabel ? `${workspaceLabel} → ${leafLabel}` : leafLabel
  if (cardKey) {
    const cardLabel = getCardLabel(cardKey)
    if (!cardLabel) return null
    path = `${path} · ${cardLabel}`
  }
  return path
}

/** Find which top-level entry a leaf belongs to. Returns undefined if not found. */
export function getWorkspaceForLeaf(leafKey: string): string | undefined {
  for (const entry of systemSettingsTree) {
    if ("children" in entry) {
      if (entry.children.some((c) => c.key === leafKey)) return entry.key
    } else if (entry.key === leafKey) {
      return entry.key
    }
  }
  return undefined
}

/** Get all leaf keys. */
export function getAllSystemLeafKeys(): string[] {
  return systemSettingsTree.flatMap((entry) =>
    "children" in entry ? entry.children.map((c) => c.key) : [entry.key]
  )
}
