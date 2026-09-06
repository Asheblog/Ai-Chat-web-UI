/**
 * 深度研究计划工具定义与参数解析/校验。
 */

import type { ToolDefinition } from '../../agent-runtime/tool-handler-types'

export const RESEARCH_PLAN_TOOL_NAME = 'research_plan'
export const RESEARCH_PLAN_DELIVERABLE = 'markdown_report_with_citations_pdf'
export const MIN_RESEARCH_SUB_QUESTIONS = 3
export const MAX_RESEARCH_SUB_QUESTIONS = 6
export const MIN_KEYWORDS_PER_SUB_QUESTION = 1
export const MAX_KEYWORDS_PER_SUB_QUESTION = 3
export const MAX_RESEARCH_TITLE_CHARS = 160
export const MAX_RESEARCH_OBJECTIVE_CHARS = 600
export const MAX_RESEARCH_SUB_QUESTION_CHARS = 300
export const MAX_RESEARCH_KEYWORD_CHARS = 80
export const MAX_RESEARCH_NOTES_CHARS = 1200

export interface ResearchPlanPayload {
  title: string
  objective: string
  sub_questions: Array<{
    question: string
    keywords: string[]
  }>
  estimated_tool_rounds: {
    min: number
    max: number
  }
  deliverable: string
  notes?: string
}

export type ParseResearchPlanArgsResult =
  | { ok: true; plan: ResearchPlanPayload }
  | { ok: false; error: string }

export const RESEARCH_PLAN_TOOL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: RESEARCH_PLAN_TOOL_NAME,
    description:
      '向用户提交深度研究计划并等待确认。必须在深度研究模式下执行任何搜索或网页读取之前调用；用户批准后才能继续。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '研究标题' },
        objective: { type: 'string', description: '一句话研究目标' },
        sub_questions: {
          type: 'array',
          minItems: MIN_RESEARCH_SUB_QUESTIONS,
          maxItems: MAX_RESEARCH_SUB_QUESTIONS,
          description: '3-6 个关键子问题，每个子问题包含 question 和 1-3 个搜索关键词',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string', description: '子问题' },
              keywords: {
                type: 'array',
                minItems: MIN_KEYWORDS_PER_SUB_QUESTION,
                maxItems: MAX_KEYWORDS_PER_SUB_QUESTION,
                description: '搜索关键词',
                items: { type: 'string' },
              },
            },
            required: ['question', 'keywords'],
          },
        },
        estimated_tool_rounds: {
          type: 'object',
          description: '预计工具调用轮数范围',
          properties: {
            min: { type: 'number', minimum: 1 },
            max: { type: 'number', maximum: 20 },
          },
          required: ['min', 'max'],
        },
        deliverable: {
          type: 'string',
          description: '固定交付物标识',
          const: RESEARCH_PLAN_DELIVERABLE,
        },
        notes: { type: 'string', description: '可选：假设、边界、无法回答的部分' },
      },
      required: ['title', 'objective', 'sub_questions', 'estimated_tool_rounds'],
    },
  },
}

const asTrimmedString = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

const asRound = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(20, Math.floor(value)))
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(20, parsed))
    }
  }
  return fallback
}

export const parseResearchPlanArgs = (args: Record<string, unknown>): ParseResearchPlanArgsResult => {
  const title = asTrimmedString(args.title, MAX_RESEARCH_TITLE_CHARS)
  if (!title) {
    return { ok: false, error: '研究计划缺少有效标题' }
  }
  const objective = asTrimmedString(args.objective, MAX_RESEARCH_OBJECTIVE_CHARS)
  if (!objective) {
    return { ok: false, error: '研究计划缺少有效目标' }
  }
  if (!Array.isArray(args.sub_questions)) {
    return { ok: false, error: '研究计划必须包含 sub_questions 数组' }
  }
  if (args.sub_questions.length > MAX_RESEARCH_SUB_QUESTIONS) {
    return {
      ok: false,
      error: `研究计划最多包含 ${MAX_RESEARCH_SUB_QUESTIONS} 个子问题`,
    }
  }
  const rawQuestions = args.sub_questions
  if (rawQuestions.length < MIN_RESEARCH_SUB_QUESTIONS) {
    return {
      ok: false,
      error: `研究计划必须包含 ${MIN_RESEARCH_SUB_QUESTIONS}-${MAX_RESEARCH_SUB_QUESTIONS} 个子问题`,
    }
  }
  const sub_questions: ResearchPlanPayload['sub_questions'] = []
  for (const rawQuestion of rawQuestions) {
    if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) {
      return { ok: false, error: '子问题格式无效' }
    }
    const record = rawQuestion as Record<string, unknown>
    const question = asTrimmedString(record.question, MAX_RESEARCH_SUB_QUESTION_CHARS)
    if (!question) {
      return { ok: false, error: '子问题缺少有效问题文本' }
    }
    if (!Array.isArray(record.keywords)) {
      return { ok: false, error: `子问题「${question}」缺少 keywords` }
    }
    if (record.keywords.length > MAX_KEYWORDS_PER_SUB_QUESTION) {
      return { ok: false, error: `子问题「${question}」最多包含 ${MAX_KEYWORDS_PER_SUB_QUESTION} 个关键词` }
    }
    const keywords: string[] = []
    for (const rawKeyword of record.keywords) {
      const keyword = asTrimmedString(rawKeyword, MAX_RESEARCH_KEYWORD_CHARS)
      if (!keyword) {
        return { ok: false, error: `子问题「${question}」包含无效关键词` }
      }
      if (!keywords.includes(keyword)) {
        keywords.push(keyword)
      }
    }
    if (keywords.length < MIN_KEYWORDS_PER_SUB_QUESTION) {
      return { ok: false, error: `子问题「${question}」至少需要 1 个关键词` }
    }
    sub_questions.push({ question, keywords })
  }

  if (!args.estimated_tool_rounds || typeof args.estimated_tool_rounds !== 'object') {
    return { ok: false, error: '研究计划必须包含 estimated_tool_rounds' }
  }
  const rawRounds = args.estimated_tool_rounds as Record<string, unknown>
  if (rawRounds.min == null || rawRounds.max == null) {
    return { ok: false, error: 'estimated_tool_rounds 必须包含 min 和 max' }
  }
  const min = asRound(rawRounds.min, 1)
  const max = asRound(rawRounds.max, Math.max(min, 3))
  const estimated_tool_rounds = {
    min: Math.min(min, max),
    max: Math.max(min, max),
  }

  const notes = asTrimmedString(args.notes, MAX_RESEARCH_NOTES_CHARS)
  return {
    ok: true,
    plan: {
      title,
      objective,
      sub_questions,
      estimated_tool_rounds,
      deliverable: RESEARCH_PLAN_DELIVERABLE,
      ...(notes ? { notes } : {}),
    },
  }
}
