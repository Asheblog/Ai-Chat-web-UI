/**
 * 过程工作区 / 调用台账的对外契约（冻结）。
 *
 * 消费方只有两处：
 * - 摘要入口 ProcessWorkspaceEntry：替换原 CotTimeline 的调用点，props 全量兼容并新增 content / artifacts / coverage / readOnly / commands。
 * - 宿主 ProcessWorkspaceHost：包住主聊天整个 flex 区域，提供 ≥1440 双栏 / 768—1439 覆盖 / <768 全屏。
 *
 * 没有宿主时 Entry 自己开本地抽屉，分享、Battle 和任意独立调用点照旧可用。
 * 这里的类型只描述"调用方要给什么"，内部投影/视图模型不在此文件，避免契约随实现漂移。
 */
import type { ReactNode } from 'react'
import type { ToolCallStatus } from '@aichat/shared/api-contract'
import type { MessageMeta, ToolEvent, WorkspaceArtifact } from '@/types'

/* ── 作用域与命令 ───────────────────────────────────────────── */

/** 工作区面板的三个页签：过程 / 来源 / 产物 */
export type ProcessWorkspaceTab = 'process' | 'sources' | 'artifacts'

/** 命令目标：只有真实会话（sessionId > 0）且非只读时才可派发。 */
export interface ProcessCommandTarget {
  sessionId: number
  messageId: number | string
  clientMessageId?: string | null
}

/** 后端 complete 事件给出的停止原因；缺失即未知，不推断。 */
export type ProcessStopReason = 'stop_tools' | 'budget_exhausted'

/**
 * 整轮终态。由 hydration 写入 meta（meta.stopReason / meta.finalAnswerGenerated），
 * 分享 / Battle / 测试可用 props.runTerminal 显式覆盖（显式值优先）。
 * finalAnswerGenerated === false 时必须显示"未生成最终回答"，不得沿用成功徽标；streamStatus 仍是 done。
 */
export interface ProcessRunTerminal {
  /** 数据库/水合可能给出 null；null 与缺失同义（未知），不当作"已生成"。 */
  stopReason?: ProcessStopReason | null
  finalAnswerGenerated?: boolean | null
}

/** 停止工具的受理回执：accepted 只表示已受理，运行结果要靠后续运行事件确认。 */
export interface StopToolsAcceptance {
  accepted: boolean
  reason?: string
}

/** onStopTools 可同步或异步返回回执；抛错或 accepted:false 时保留错误并可重试。 */
export type StopToolsCommandResult = StopToolsAcceptance | void

/** 研究计划审批：只转发真实审批通道，不新建通用工具审批。 */
export interface ResearchPlanDecision {
  callId: string
  decision: 'approve' | 'adjust' | 'cancel' | 'continue'
  /** adjust 必填：用户改写计划的反馈 */
  feedback?: string
  revision?: number
}

/**
 * 执行命令。全部由调用方提供，工作区自己不发请求。
 * 未提供的命令不渲染可执行控件；readOnly 或 sessionId <= 0（Battle）时一律只读。
 */
export interface ProcessWorkspaceCommands {
  /** 停止后续工具，保留连接完成答案。受理后等待运行事件反馈，不乐观改状态。 */
  onStopTools?: (
    target: ProcessCommandTarget,
  ) => Promise<StopToolsCommandResult> | StopToolsCommandResult
  /** 整轮取消（真正中止），不触发额外模型请求。 */
  onCancelRun?: (target: ProcessCommandTarget) => Promise<unknown> | unknown
  /** 整轮重新生成。它不等于单次工具重试，文案与入口都按整轮表达。 */
  onRegenerate?: (target: ProcessCommandTarget) => Promise<unknown> | unknown
  onResearchPlanDecision?: (decision: ResearchPlanDecision) => Promise<unknown> | unknown
  /**
   * 计划过期或中止后的"重新发起"：由宿主用原问题重新发起（历史实现是
   * 派发 aichat:composer-prefill 把原问题回填到输入框）。未提供时不渲染按钮。
   */
  onReissuePlan?: (input: { reason: 'expired' | 'aborted'; planTitle: string }) => void
}

/* ── 记录覆盖 ───────────────────────────────────────────────── */

/** 三态：complete / partial / unknown。旧数据缺失只能是 unknown，不能显示成完整。 */
export type ProcessCoverageStatus = 'complete' | 'partial' | 'unknown'

/**
 * 单层覆盖。字段与共享契约 ToolLogCoverageLayer 同名同义，可直接透传。
 * 状态字符串形态只在内部归一化时接受，对外契约保持层对象，避免调用方到处判断联合类型。
 */
export interface ProcessCoverageLayer {
  status: ProcessCoverageStatus
  asOf?: number
  startedAt?: number
  turnEndedAt?: number
  /** 已知被丢弃的原始记录数；未知时不传入，界面也不显示 0。 */
  droppedRecords?: number
  /** 被压缩/截断的字段数；与丢记录分开计量。 */
  truncatedFields?: number
}

/** 分层覆盖：压缩字段和丢记录分别计量，执行结果与覆盖缺口各说各的。 */
export interface ProcessCoverage {
  trace?: ProcessCoverageLayer
  persisted?: ProcessCoverageLayer
  projection?: ProcessCoverageLayer
}

/* ── 快照与入口 ─────────────────────────────────────────────── */

/**
 * 一条消息的过程快照。Entry 在打开时交给宿主，之后每次 props 变化再发布一次，
 * 宿主拿着它渲染面板，所以消息行被虚拟列表卸载也不会丢掉正在看的过程。
 */
export interface ProcessSnapshot {
  meta: MessageMeta
  reasoningRaw: string
  toolEvents: ToolEvent[]
  content?: string
  artifacts?: WorkspaceArtifact[]
  coverage?: ProcessCoverage
  readOnly?: boolean
  commands?: ProcessWorkspaceCommands
  isStreaming?: boolean
  reasoningPlayedLength?: number
  runTerminal?: ProcessRunTerminal
}

export interface ProcessWorkspaceEntryProps extends ProcessSnapshot {
  /** Battle 详情等调用方要求直接展开（原 CotTimeline defaultExpanded 语义）。 */
  defaultExpanded?: boolean
  /** 打开时的默认页签，默认 'process'。 */
  defaultTab?: ProcessWorkspaceTab
  /**
   * 面板承载方式：'drawer'（默认，Radix Sheet 模态）或 'inline'（就地展开在正文下方，
   * 用于 Battle 详情这类已有多层模态的容器）。有宿主时由宿主承载，本字段不生效。
   */
  presentation?: 'drawer' | 'inline'
  /**
   * 从关闭变为打开时回调一次（defaultExpanded 首次挂载也算打开）。
   * 用于宿主按需拉取完整工具详情；这里不自带请求，也不触发 stop 等命令。
   */
  onOpen?: () => void
  className?: string
}

export interface ProcessWorkspaceHostProps {
  children: ReactNode
  /** ≥1440 双栏时的侧栏宽度，默认 440。 */
  width?: number
  className?: string
}

/** 宿主通过 context 提供给 Entry；没有宿主时 Entry 走本地抽屉。 */
export interface ProcessWorkspaceHostApi {
  openEntry(key: string, snapshot: ProcessSnapshot): void
  publish(key: string, snapshot: ProcessSnapshot): void
  closeEntry(): void
  activeKey: string | null
}

/* ── 台账 ───────────────────────────────────────────────────── */

/**
 * 全宽调用台账：当前消息的完整调用视图，不是全局 task-trace 诊断页。
 * 从工作区面板打开，关闭回到回答原阅读位置。
 */
export interface CallLedgerProps {
  meta: MessageMeta
  toolEvents: ToolEvent[]
  coverage?: ProcessCoverage
  readOnly?: boolean
  onReturn?: () => void
  className?: string
}

/* ── 解析出的作用域（内部与测试共用） ───────────────────────── */

/** 命令能力来源：chat 可派发，share 强制只读，battle（sessionId 0）不可发 chat 命令。 */
export type ProcessOrigin = 'chat' | 'share' | 'battle'

export interface ProcessScope {
  /** 稳定作用域键，用于披露偏好、页签记忆与滚动位置。 */
  key: string
  sessionId: number
  origin: ProcessOrigin
  readOnly: boolean
  /** 是否允许派发命令：非只读且 sessionId > 0。 */
  canCommand: boolean
  /** 命令目标（不含 clientMessageId 时按 messageId 定位）。 */
  target: ProcessCommandTarget
}

/** 视图层统一使用的状态别名，与 shared resolveEventStatus 的取值完全一致。 */
export type ProcessStatus = ToolCallStatus
