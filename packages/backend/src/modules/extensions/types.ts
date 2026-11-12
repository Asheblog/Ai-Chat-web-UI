/**
 * 扩展安装（AI 自助安装 MCP / Skill）类型定义。
 *
 * 一条 GitHub 源经「解析 → 探测 → 判定」得到 InstallPlan，再由安装器落到
 * Skill 安装链路或 MCP 安装/连接/绑定链路。
 */

export type ExtensionKind = 'skill' | 'mcp'

export type McpSourceType = 'remote' | 'local_package'

export type McpTransport = 'streamable_http' | 'sse' | 'stdio'

/** 解析后的 GitHub 源引用。ref/subdir 允许缺省，由探测层补默认分支。 */
export interface ExtensionSourceRef {
  owner: string
  repo: string
  ref?: string
  subdir?: string
  /** 用户原始输入，用于回显与审计 */
  raw: string
}

/** 探测到的仓库文件集合：只含白名单文件，避免整包下载。 */
export interface ProbeFileSet {
  files: Record<string, string>
  /** 因体积/数量上限被裁掉的文件 */
  skipped: string[]
  /** 实际使用的分支；缺省时代理为仓库默认分支 */
  ref: string
}

export interface ExtensionEnvRequirement {
  name: string
  reason: string
}

/** 判定产物：安装器只认这一份结构。 */
export interface InstallPlan {
  kind: ExtensionKind
  /** 展示名，如 github-mcp-server */
  name: string
  /** 稳定标识，MCP 用作 namespaceKey，Skill 用作建议 slug */
  slug: string
  /** 判定置信度：high 来自清单文件，medium 来自 README，low 来自目录命名 */
  confidence: 'high' | 'medium' | 'low'
  /** 判定依据，直接回给模型解释「为什么这么装」 */
  reason: string
  source: ExtensionSourceRef
  sourceUrl: string

  // --- kind = mcp ---
  sourceType?: McpSourceType
  transport?: McpTransport
  endpoint?: string
  command?: string
  args?: string[]
  envKeys?: ExtensionEnvRequirement[]
  headers?: Record<string, string>

  // --- kind = skill ---
  /** Skill 实际所在子目录（相对仓库根） */
  subdir?: string
}

export type DetectStatus = 'resolved' | 'ambiguous' | 'unsupported'

export interface DetectResult {
  status: DetectStatus
  plan?: InstallPlan
  /** ambiguous 时给模型两个候选，由模型追问用户 */
  candidates?: InstallPlan[]
  /** unsupported / ambiguous 的人类可读说明 */
  message?: string
  /** 探测覆盖到的文件，便于排障 */
  probed?: string[]
}

export type InstallStatus =
  | 'ready'
  | 'needs_secret'
  | 'pending_approval'
  | 'pending_validation'
  | 'pending_gateway'
  | 'registered_unverified'
  | 'already_installed'

export interface InstalledPayload {
  installationId?: number
  connectionId?: number
  skillId?: number
  versionId?: number
}

/** 安装请求：工具层与服务层共用的稳定形状（不依赖 agent-runtime 类型）。 */
export interface ExtensionInstallRequest {
  source: string
  kindHint?: 'auto' | 'skill' | 'mcp'
  scope?: 'user' | 'system'
  enable?: boolean
  actorUserId: number
  sessionId?: number | null
  onProgress?: (stage: string, detail: string) => void
}

export interface ExtensionInstallServiceLike {
  installFromSource(input: ExtensionInstallRequest): Promise<InstallOutcome>
}

export interface InstallOutcome {
  ok: boolean
  status?: InstallStatus
  plan?: InstallPlan
  installed?: InstalledPayload
  tools?: Array<{ name: string; description: string | null }>
  requiredSecrets?: ExtensionEnvRequirement[]
  nextSteps?: string[]
  warnings?: string[]
  /** 判定为 ambiguous 时的候选项，由模型追问用户 */
  candidates?: InstallPlan[]
  error?: string
}
