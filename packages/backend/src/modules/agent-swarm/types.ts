/**
 * Agent Swarm 类型定义
 *
 * Kimi 风格的 agent swarm 系统，将复杂用户查询分解为子任务，
 * 由多类 SubAgent 并行或串行执行，最终合成为完整答案。
 */

// ============================================================================
// 基础枚举类型
// ============================================================================

/**
 * 子任务类型 - 区分不同职责的 Agent
 */
export type SubTaskType = 'search' | 'fetch' | 'python' | 'analyze' | 'synthesize';

/**
 * 子任务执行状态
 */
export type SubTaskStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

/**
 * Swarm 执行阶段
 */
export type SwarmPhase =
  | 'planning'
  | 'executing'
  | 'analyzing'
  | 'synthesizing'
  | 'verifying'
  | 'completed'
  | 'error';

/**
 * 验证策略
 */
export type VerificationStrategy = 'strict' | 'normal' | 'light';

// ============================================================================
// 子任务与执行计划
// ============================================================================

/**
 * 子任务定义
 *
 * 使用 discriminated fields 模式：不同 type 的任务使用不同的可选字段。
 * - search: 使用 query 字段
 * - fetch: 使用 urls 字段
 * - python: 使用 code 字段
 * - analyze / synthesize: 使用 context 字段
 */
export interface SubTask {
  /** 任务唯一标识 */
  id: string;

  /** 任务类型 */
  type: SubTaskType;

  /** 人类可读的任务描述 */
  description: string;

  /** 搜索查询语句（search 专用） */
  query?: string;

  /** 待抓取的 URL 列表（fetch 专用） */
  urls?: string[];

  /** Python 代码（python 专用） */
  code?: string;

  /** 分析/合成上下文（analyze / synthesize 专用） */
  context?: string;

  /** 优先级，数字越小优先级越高 */
  priority: number;

  /** 依赖的任务 ID 列表，依赖完成后本任务才可执行 */
  dependsOn: string[];

  /** 超时时间（毫秒），不设置则使用全局默认值 */
  timeoutMs?: number;

  /** 任务级重试次数（可选） */
  maxRetries?: number;
}

/**
 * 依赖图 - 描述任务间的并行/串行关系
 */
export interface DependencyGraph {
  /** 所有子任务 */
  tasks: SubTask[];

  /**
   * 并行组：每组内的任务可并行执行，组间串行。
   * 外层数组顺序即为执行顺序。
   */
  parallelGroups: string[][];
}

/**
 * Swarm 任务计划 - 由 Planner Agent 生成
 */
export interface SwarmTaskPlan {
  /** 计划唯一标识 */
  planId: string;

  /** 用户原始查询 */
  originalQuery: string;

  /** 拆分后的子任务列表 */
  tasks: SubTask[];

  /** 任务依赖图 */
  dependencyGraph: DependencyGraph;

  /** 最大执行轮次（用于 gap-fill 循环） */
  maxRounds: number;

  /** 验证严格程度 */
  verificationStrategy: VerificationStrategy;

  /** 计划创建时间戳（ms） */
  createdAt: number;
}

// ============================================================================
// Scraper 回退策略类型
// ============================================================================

/**
 * 抓取策略 - 按回退优先级排列
 */
export type ScraperStrategy =
  | 'native'
  | 'browser'
  | 'python_requests'
  | 'cloudscraper'
  | 'playwright_stealth'
  | 'curl'
  | 'wayback_machine'
  | 'google_cache';

/**
 * 抓取策略尝试状态
 */
export type ScraperStrategyStatus = 'attempted' | 'success' | 'failed' | 'skipped';

/**
 * 单次抓取尝试记录
 */
export interface ScraperAttempt {
  /** 使用的策略 */
  strategy: ScraperStrategy;

  /** 尝试结果 */
  status: ScraperStrategyStatus;

  /** 耗时（毫秒） */
  durationMs: number;

  /** 错误信息（失败时填充） */
  error?: string;

  /** 抓取内容长度（成功时填充） */
  contentLength?: number;
}

/**
 * URL 抓取结果
 */
export interface FetchResult {
  /** 目标 URL */
  url: string;

  /** 页面标题 */
  title?: string;

  /** 原始内容 */
  content?: string;

  /** 提取的纯文本 */
  textContent?: string;

  /** 内容摘要（内容过长时截取） */
  excerpt?: string;

  /** 抓取状态 */
  status: 'success' | 'partial' | 'failed';

  /** 所有策略的尝试记录 */
  attempts: ScraperAttempt[];

  /** 最终成功的策略 */
  finalStrategy?: ScraperStrategy;
}

// ============================================================================
// Agent 执行结果
// ============================================================================

/**
 * 子 Agent 执行结果
 */
export interface SubAgentResult {
  /** 对应的任务 ID */
  taskId: string;

  /** Agent 类型 */
  agentType: SubTaskType;

  /** 执行状态 */
  status: SubTaskStatus;

  /** 人类可读的结果摘要 */
  summary: string;

  /** 结构化详情 */
  details: Record<string, unknown>;

  /** 错误信息（失败时填充） */
  error?: string;

  /** 执行耗时（毫秒） */
  durationMs: number;

  /** 工具调用次数 */
  toolCalls: number;
}

// ============================================================================
// Swarm 执行状态
// ============================================================================

/**
 * Swarm 全局执行状态 - 贯穿整个执行周期的状态机
 */
export interface SwarmExecutionState {
  /** 计划 ID */
  planId: string;

  /** 当前阶段 */
  phase: SwarmPhase;

  /** 各任务状态映射 */
  tasks: Map<string, SubTaskStatus>;

  /** 已完成任务的结果列表 */
  results: SubAgentResult[];

  /** 当前执行轮次 */
  currentRound: number;

  /** 验证阶段发现的缺口描述 */
  gapsFound: string[];

  /** 执行开始时间戳 */
  startedAt?: number;

  /** 执行完成时间戳 */
  completedAt?: number;
}

// ============================================================================
// SubAgent 配置接口
// ============================================================================

/**
 * 子 Agent 基础配置
 */
export interface SubAgentBaseConfig {
  /** 是否启用该类型 Agent */
  enabled: boolean;

  /** 默认超时（毫秒） */
  timeoutMs: number;

  /** 最大重试次数 */
  maxRetries: number;
}

/**
 * Search Agent 配置
 */
export interface SearchAgentConfig extends SubAgentBaseConfig {
  /** 每次搜索返回的最大结果数 */
  resultLimit: number;

  /** 启用的搜索引擎列表 */
  engines: string[];

  /** 搜索引擎优先级顺序 */
  engineOrder: string[];
}

/**
 * Fetch Agent 配置
 */
export interface FetchAgentConfig extends SubAgentBaseConfig {
  /** 最大内容长度 */
  maxContentLength: number;

  /** 最大响应体大小（字节） */
  maxBodyBytes: number;

  /** 是否启用浏览器渲染 */
  enableBrowser: boolean;

  /** 浏览器可执行文件路径 */
  browserExecutablePath?: string;

  /** 浏览器渲染等待时间（毫秒） */
  renderWaitMs: number;

  /** 抓取策略回退列表 */
  scraperStrategies: ScraperStrategy[];
}

/**
 * Python Agent 配置
 */
export interface PythonAgentConfig extends SubAgentBaseConfig {
  /** 最大输出字符数 */
  maxOutputChars: number;

  /** 最大源码字符数 */
  maxSourceChars: number;
}

/**
 * Analyze Agent 配置
 */
export interface AnalyzeAgentConfig extends SubAgentBaseConfig {
  /** 分析使用的模型 */
  model?: string;

  /** 是否启用交叉验证 */
  crossValidation: boolean;
}

/**
 * Synthesize Agent 配置
 */
export interface SynthesizeAgentConfig extends SubAgentBaseConfig {
  /** 合成使用的模型 */
  model?: string;

  /** 最大合成轮次 */
  maxSynthesisRounds: number;
}

/**
 * 子 Agent 配置聚合
 */
export interface SubAgentConfigMap {
  search: SearchAgentConfig;
  fetch: FetchAgentConfig;
  python: PythonAgentConfig;
  analyze: AnalyzeAgentConfig;
  synthesize: SynthesizeAgentConfig;
}

// ============================================================================
// Swarm 全局配置
// ============================================================================

/**
 * Swarm 全局配置
 */
export interface SwarmConfig {
  /** 启用 Agent Swarm 模式 */
  enabled: boolean;

  /** 最大并行任务数 */
  maxParallelTasks: number;

  /** 最大执行轮次 */
  maxRounds: number;

  /** 默认验证策略 */
  verificationStrategy: VerificationStrategy;

  /** 各类型 Agent 配置 */
  agents: SubAgentConfigMap;
}

// ============================================================================
// SSE 事件类型
// ============================================================================

/**
 * Swarm 计划事件
 */
export interface SwarmPlanEvent {
  plan: SwarmTaskPlan;
}

/**
 * 任务开始事件
 */
export interface SwarmTaskStartEvent {
  taskId: string;
  type: SubTaskType;
  description: string;
}

/**
 * 任务进度事件
 */
export interface SwarmTaskProgressEvent {
  taskId: string;
  status: SubTaskStatus;
  message: string;
}

/**
 * 任务完成事件
 */
export interface SwarmTaskCompleteEvent {
  taskId: string;
  result: SubAgentResult;
}

/**
 * 任务错误事件
 */
export interface SwarmTaskErrorEvent {
  taskId: string;
  error: string;
}

/**
 * 阶段切换事件
 */
export interface SwarmPhaseEvent {
  phase: SwarmPhase;
}

/**
 * 缺口发现事件（触发新一轮执行）
 */
export interface SwarmGapEvent {
  description: string;
  round: number;
}

/**
 * 验证结果事件
 */
export interface SwarmVerifyEvent {
  passed: boolean;
  issues: string[];
}

/**
 * Swarm 完成事件
 */
export interface SwarmCompleteEvent {
  summary: string;
}

/**
 * Swarm SSE 事件类型映射
 *
 * key 为 SSE event name，value 为对应 payload 类型。
 * 用于类型安全的 SSE 事件发送与监听。
 */
export interface SwarmEventMap {
  'swarm:plan': SwarmPlanEvent;
  'swarm:task_start': SwarmTaskStartEvent;
  'swarm:task_progress': SwarmTaskProgressEvent;
  'swarm:task_complete': SwarmTaskCompleteEvent;
  'swarm:task_error': SwarmTaskErrorEvent;
  'swarm:phase': SwarmPhaseEvent;
  'swarm:gap': SwarmGapEvent;
  'swarm:verify': SwarmVerifyEvent;
  'swarm:complete': SwarmCompleteEvent;
}

/**
 * Swarm 事件名称
 */
export type SwarmEventName = keyof SwarmEventMap;

/**
 * 根据事件名获取对应的 payload 类型
 */
export type SwarmEventPayload<K extends SwarmEventName> = SwarmEventMap[K];

// ============================================================================
// 工厂与依赖注入类型
// ============================================================================

/**
 * 子 Agent 工厂参数
 */
export interface SubAgentFactoryParams {
  config: SubAgentConfigMap;
  emitEvent: <K extends SwarmEventName>(event: K, payload: SwarmEventPayload<K>) => void;
  signal?: AbortSignal;
}

/**
 * 子 Agent 接口 - 所有 Agent 必须实现的基础契约
 */
export interface ISubAgent {
  /** Agent 类型标识 */
  readonly agentType: SubTaskType;

  /** 执行子任务 */
  execute(task: SubTask): Promise<SubAgentResult>;

  /** 取消当前执行 */
  abort(): void;
}
