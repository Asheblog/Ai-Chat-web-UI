/**
 * 轻量 Task Planning 机制
 *
 * 这是"prompt 级"的计划机制，不是独立的 LLM 调用。
 * 计划从 LLM 的 reasoning/thinking 文本中提取，不增加额外 token 消耗。
 * 功能：计划解析 + 偏差检测 + 系统提示词模板生成。
 */

// ─── 数据模型 ────────────────────────────────────────────

export type PlanAction = 'search' | 'read_url' | 'python' | 'synthesize' | 'other'
export type PlanStepStatus = 'pending' | 'done' | 'skipped'

export interface PlanStep {
  id: number
  action: PlanAction
  description: string
  status: PlanStepStatus
  queries?: string[]
  urls?: string[]
}

export interface TaskPlan {
  steps: PlanStep[]
  estimatedRounds: number
  complete: boolean
}

// ─── 计划指令模板 ────────────────────────────────────────

/**
 * 生成注入 system prompt 的任务执行计划指令。
 * 当启用 web_search / url_reader 等工具时，应在 system prompt 末尾追加此指令。
 */
export function buildTaskPlanningPrompt(): string {
  return `## 任务执行计划

在执行工具调用之前，请先在思考中制定执行计划：

1. 列出需要完成的具体步骤（搜索、读网页、数据分析等）
2. 评估每步需要调用什么工具
3. 标识哪些步骤可以并行执行
4. 预估还需要多少轮工具调用

每轮结束后，评估：
- 哪些步骤已完成
- 是否还有信息缺口
- 是否需要补充搜索或分析

注意：计划建议仅用于整理思路，实际执行中可根据信息发现动态调整。`
}

// ─── 计划解析 ────────────────────────────────────────────

// 匹配列表项的通用前缀：支持 "- " / "* " / "1. " / "①" 等格式
const LIST_PREFIX = /(?:[-*]|\d+\.)\s*/

// 匹配列表中 "搜索" 行，格式：- 搜索"xxx" 或 1. 搜索xxx
const SEARCH_LINE_RE = new RegExp(
  LIST_PREFIX.source + '搜索[：:]\\s*(.+?)(?:$|\\n)', 'g',
)

// 匹配 "读取网页" / "读网页" 行
const READ_URL_LINE_RE = new RegExp(
  LIST_PREFIX.source + '(?:读取网页|读网页|打开)[：:]\\s*(.+?)(?:$|\\n)', 'g',
)

// 匹配 Python 脚本行
const PYTHON_LINE_RE = new RegExp(
  LIST_PREFIX.source + '(?:Python|python|数据分析|计算)[：:]\\s*(.+?)(?:$|\\n)', 'g',
)

// 匹配综合/总结行
const SYNTHESIZE_LINE_RE = new RegExp(
  LIST_PREFIX.source + '(?:综合|总结|整理|回答|整合)[：:]\\s*(.+?)(?:$|\\n)', 'g',
)

// 匹配带 "- " / "* " 前缀的通用步骤行（函数内每次创建新实例，避免 /g 共享 lastIndex）

// 匹配计划标题
const PLAN_HEADER_RE = /(?:任务执行计划|执行计划|执行步骤|计划|Plan)\s*[：:]*\s*/i

// 匹配预估轮数
const ESTIMATED_ROUNDS_RE = /预估.*?(\d+)[-~](\d+)\s*轮/
const SINGLE_ROUND_RE = /预估.*?(\d+)\s*轮/

/**
 * 从 LLM 回复文本中提取计划。
 * 使用正则匹配常见的计划格式。
 */
export function extractPlanFromText(text: string): TaskPlan | null {
  if (!text || typeof text !== 'string') return null

  const trimmed = text.trim()
  if (!trimmed) return null

  const steps: PlanStep[] = []
  let stepId = 0

  // 1. 提取 "搜索" 步骤
  const searchMatches = extractMatches(trimmed, SEARCH_LINE_RE)
  for (const match of searchMatches) {
    stepId += 1
    steps.push({
      id: stepId,
      action: 'search',
      description: match.description,
      status: 'pending',
      queries: [match.description],
    })
  }

  // 2. 提取 "读取网页" 步骤
  const readMatches = extractMatches(trimmed, READ_URL_LINE_RE)
  for (const match of readMatches) {
    stepId += 1
    steps.push({
      id: stepId,
      action: 'read_url',
      description: match.description,
      status: 'pending',
      urls: extractUrls(match.description),
    })
  }

  // 3. 提取 Python 步骤
  const pythonMatches = extractMatches(trimmed, PYTHON_LINE_RE)
  for (const match of pythonMatches) {
    stepId += 1
    steps.push({
      id: stepId,
      action: 'python',
      description: match.description,
      status: 'pending',
    })
  }

  // 4. 提取综合/总结步骤
  const synthesizeMatches = extractMatches(trimmed, SYNTHESIZE_LINE_RE)
  for (const match of synthesizeMatches) {
    stepId += 1
    steps.push({
      id: stepId,
      action: 'synthesize',
      description: match.description,
      status: 'pending',
    })
  }

  if (steps.length === 0) {
    // 如果没有匹配到特定类型的步骤，尝试匹配通用的 "- xxx" 格式
    // 但要排除非计划内容（如结果列表、摘要等）
    if (isPlanSection(trimmed)) {
      const genericSteps = extractGenericSteps(trimmed)
      if (genericSteps.length > 0) {
        return {
          steps: genericSteps,
          estimatedRounds: estimateRounds(trimmed),
          complete: false,
        }
      }
    }
    return null
  }

  return {
    steps,
    estimatedRounds: estimateRounds(trimmed),
    complete: false,
  }
}

interface MatchItem {
  description: string
  raw: string
}

function extractMatches(text: string, regex: RegExp): MatchItem[] {
  const results: MatchItem[] = []
  // 需要重置 lastIndex 因为使用了全局标志
  const re = new RegExp(regex.source, regex.flags)
  let match = re.exec(text)
  while (match !== null) {
    const desc = (match[1] || '').trim()
    if (desc) {
      results.push({ description: desc, raw: match[0] })
    }
    match = re.exec(text)
  }
  return results
}

function extractGenericSteps(text: string): PlanStep[] {
  const steps: PlanStep[] = []
  let stepId = 0

  // 找到计划区域的行
  const lines = text.split('\n')
  let inPlanSection = false

  const genericStepRe = /^[-*]\s*(.+?)(?:$|\n)/gm

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 检测计划区域开始
    if (PLAN_HEADER_RE.test(trimmed)) {
      inPlanSection = true
      continue
    }

    // 遇到新的标题行则退出计划区域
    if (inPlanSection && /^#{1,3}\s/.test(trimmed)) {
      break
    }

    if (inPlanSection) {
      const stepMatch = genericStepRe.exec(trimmed)
      if (stepMatch) {
        genericStepRe.lastIndex = 0
        const desc = (stepMatch[1] || '').trim()
        if (desc && !isMetaLine(desc)) {
          stepId += 1
          steps.push({
            id: stepId,
            action: classifyAction(desc),
            description: desc,
            status: 'pending',
          })
        }
      }
    }
  }

  return steps
}

function isMetaLine(text: string): boolean {
  const metaPatterns = [
    /^预估/,
    /^注意/,
    /^说明/,
    /^注[：:]/,
    /^提示/,
    /^建议/,
    /^以上/,
    /^概要/,
    /^摘要/,
  ]
  return metaPatterns.some((p) => p.test(text))
}

function classifyAction(text: string): PlanAction {
  const lower = text.toLowerCase()
  if (/搜索|search|查找|检索/.test(lower)) return 'search'
  if (/读取|网页|read|url|打开链接|浏览|访问.*页/.test(lower)) return 'read_url'
  if (/python|脚本|代码|计算|分析数据|绘图|图表/.test(lower)) return 'python'
  if (/综合|总结|整理|回答|撰写|生成|输出/.test(lower)) return 'synthesize'
  return 'other'
}

function isPlanSection(text: string): boolean {
  if (!PLAN_HEADER_RE.test(text)) return false
  // 只在 PLAN_HEADER 之后的区域检测步骤行，避免把结果展示段误判为计划
  const headerMatch = text.match(PLAN_HEADER_RE)
  if (!headerMatch || headerMatch.index == null) return false
  const afterHeader = text.slice(headerMatch.index)
  return /^[-*]\s*(?:搜索|读取|Python|综合|总结|分析|计算)/m.test(afterHeader)
}

function estimateRounds(text: string): number {
  const multiRound = ESTIMATED_ROUNDS_RE.exec(text)
  if (multiRound) {
    const min = parseInt(multiRound[1], 10)
    const max = parseInt(multiRound[2], 10)
    return Math.max(min, max, 1)
  }
  const singleRound = SINGLE_ROUND_RE.exec(text)
  if (singleRound) {
    return Math.max(1, parseInt(singleRound[1], 10))
  }
  return 1
}

function extractUrls(text: string): string[] {
  const urlRe = /https?:\/\/[^\s,，、；;。]+/g
  const matches = text.match(urlRe)
  return matches ? Array.from(new Set(matches)) : []
}

// ─── 偏差检测 ────────────────────────────────────────────

const ACTION_TO_TOOL_MAP: Record<PlanAction, string[]> = {
  search: ['web_search'],
  read_url: ['read_url'],
  python: ['python_runner', 'workspace_list_files', 'workspace_read_text', 'workspace_git_clone'],
  synthesize: [], // synthesize 步骤不需要工具调用
  other: [],
}

/**
 * 检测 LLM 实际工具调用是否偏离计划。
 * 返回偏差描述数组；空数组表示无偏差。
 *
 * 注意：这用于观察性检测，不强制约束执行。
 * 实际中 LLM 可能因为新发现的信息而合理偏离计划。
 */
export function detectPlanDeviation(
  plan: TaskPlan,
  actualToolCalls: string[],
): string[] {
  const deviations: string[] = []

  if (!plan || plan.steps.length === 0) return deviations

  const calledSet = new Set(actualToolCalls)
  const pendingSteps = plan.steps.filter((s) => s.status === 'pending')

  // 1. 检测计划中未预期的工具调用
  const plannedActions = new Set(pendingSteps.map((s) => s.action))
  const plannedTools = new Set(
    Array.from(plannedActions).flatMap((a) => ACTION_TO_TOOL_MAP[a] || []),
  )

  for (const called of calledSet) {
    if (!plannedTools.has(called) && called !== 'web_search') {
      deviations.push(`调用了计划外的工具: ${called}`)
    }
  }

  // 2. 检测是否有计划步骤被跳过（指计划要求搜索但没有调用对应工具）
  for (const step of pendingSteps) {
    const expectedTools = ACTION_TO_TOOL_MAP[step.action] || []
    if (expectedTools.length === 0) continue

    const anyCalled = expectedTools.some((t) => calledSet.has(t))
    if (!anyCalled) {
      deviations.push(
        `计划步骤 ${step.id}（${step.action}：${step.description}）未在本轮执行`,
      )
    }
  }

  return deviations
}

/**
 * 评估计划完成度。
 * 返回完成比例 (0-1) 和未完成步骤的描述。
 */
export function evaluatePlanProgress(plan: TaskPlan): {
  ratio: number
  pendingSteps: PlanStep[]
  allDone: boolean
} {
  if (!plan || plan.steps.length === 0) {
    return { ratio: 1, pendingSteps: [], allDone: true }
  }

  const doneSteps = plan.steps.filter(
    (s) => s.status === 'done' || s.status === 'skipped',
  )
  const pendingSteps = plan.steps.filter((s) => s.status === 'pending')

  return {
    ratio: doneSteps.length / plan.steps.length,
    pendingSteps,
    allDone: pendingSteps.length === 0,
  }
}
