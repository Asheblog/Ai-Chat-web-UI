/**
 * task-planning 模块测试
 */

import {
  extractPlanFromText,
  detectPlanDeviation,
  evaluatePlanProgress,
  buildTaskPlanningPrompt,
  type TaskPlan,
} from '../task-planning'

describe('task-planning', () => {
  describe('buildTaskPlanningPrompt', () => {
    it('should return a non-empty prompt string', () => {
      const prompt = buildTaskPlanningPrompt()
      expect(prompt).toBeTruthy()
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(50)
    })

    it('should include task planning keywords', () => {
      const prompt = buildTaskPlanningPrompt()
      expect(prompt).toContain('执行计划')
      expect(prompt).toContain('工具')
      expect(prompt).toContain('信息缺口')
    })
  })

  describe('extractPlanFromText', () => {
    it('should return null for empty input', () => {
      expect(extractPlanFromText('')).toBeNull()
      expect(extractPlanFromText('   ')).toBeNull()
    })

    it('should extract search steps from plan text', () => {
      const text = `任务执行计划：
1. 搜索: 2025年AI发展趋势
2. 搜索: GPT-5 release date
3. 综合: 总结搜索结果`

      const plan = extractPlanFromText(text)
      expect(plan).not.toBeNull()
      expect(plan!.steps).toHaveLength(3)

      const searchSteps = plan!.steps.filter((s) => s.action === 'search')
      expect(searchSteps).toHaveLength(2)
      expect(searchSteps[0].description).toBe('2025年AI发展趋势')
      expect(searchSteps[1].description).toBe('GPT-5 release date')

      const synthSteps = plan!.steps.filter((s) => s.action === 'synthesize')
      expect(synthSteps).toHaveLength(1)
      expect(synthSteps[0].description).toBe('总结搜索结果')
    })

    it('should extract steps with "-" prefix', () => {
      const text = `执行计划：
- 搜索: React 19新特性
- 读取网页: https://react.dev/blog
- 综合: 整理React 19特性列表`

      const plan = extractPlanFromText(text)
      expect(plan).not.toBeNull()
      expect(plan!.steps).toHaveLength(3)

      expect(plan!.steps[0].action).toBe('search')
      expect(plan!.steps[0].description).toBe('React 19新特性')

      expect(plan!.steps[1].action).toBe('read_url')
      expect(plan!.steps[1].description).toBe('https://react.dev/blog')

      expect(plan!.steps[2].action).toBe('synthesize')
    })

    it('should extract python steps', () => {
      const text = `执行计划：
- Python: 使用pandas分析搜索数据
- 综合: 生成分析报告`

      const plan = extractPlanFromText(text)
      expect(plan).not.toBeNull()

      const pythonSteps = plan!.steps.filter((s) => s.action === 'python')
      expect(pythonSteps).toHaveLength(1)
      expect(pythonSteps[0].description).toBe('使用pandas分析搜索数据')
    })

    it('should mark all steps as pending initially', () => {
      const text = `执行计划：
- 搜索: test query
- 综合: summarize`

      const plan = extractPlanFromText(text)
      expect(plan).not.toBeNull()
      for (const step of plan!.steps) {
        expect(step.status).toBe('pending')
      }
      expect(plan!.complete).toBe(false)
    })

    it('should return null when no plan structure is detected', () => {
      const text = '这是一段普通的回复文本，没有计划结构。'
      expect(extractPlanFromText(text)).toBeNull()
    })

    it('should extract estimated rounds', () => {
      const text = `执行计划：
预估需要 2-3 轮工具调用
- 搜索: query1
- 搜索: query2`

      const plan = extractPlanFromText(text)
      expect(plan).not.toBeNull()
      expect(plan!.estimatedRounds).toBe(3)
    })

    it('should handle text without round estimation gracefully', () => {
      const text = `执行计划：
- 搜索: simple query`

      const plan = extractPlanFromText(text)
      expect(plan).not.toBeNull()
      expect(plan!.estimatedRounds).toBe(1)
    })
  })

  describe('detectPlanDeviation', () => {
    const makePlan = (steps: Array<{ action: string; description: string; status?: string }>): TaskPlan => ({
      steps: steps.map((s, i) => ({
        id: i + 1,
        action: s.action as any,
        description: s.description,
        status: (s.status as any) || 'pending',
      })),
      estimatedRounds: 1,
      complete: false,
    })

    it('should return empty array when tool calls match plan', () => {
      const plan = makePlan([
        { action: 'search', description: 'query A' },
        { action: 'read_url', description: 'read something' },
      ])
      const deviations = detectPlanDeviation(plan, ['web_search', 'read_url'])
      expect(deviations).toHaveLength(0)
    })

    it('should return empty array when plan has no steps', () => {
      const plan = makePlan([])
      const deviations = detectPlanDeviation(plan, ['web_search'])
      expect(deviations).toHaveLength(0)
    })

    it('should skip completed steps when checking', () => {
      const plan = makePlan([
        { action: 'search', description: 'Q1', status: 'done' },
        { action: 'search', description: 'Q2' },
      ])
      // 只调用了一次 web_search，但 Q1 已标记完成，只需检查 Q2
      const deviations = detectPlanDeviation(plan, ['web_search'])
      // Q2 的 action 是 search，web_search 被调用了，所以没有偏差
      expect(deviations).toHaveLength(0)
    })

    it('should detect skipped plan steps', () => {
      const plan = makePlan([
        { action: 'search', description: 'Q1' },
        { action: 'read_url', description: 'read page' },
      ])
      // 只调用了 web_search，没有调用 read_url
      const deviations = detectPlanDeviation(plan, ['web_search'])
      expect(deviations.length).toBeGreaterThan(0)
      expect(deviations.some((d) => d.includes('read_url'))).toBe(true)
    })
  })

  describe('evaluatePlanProgress', () => {
    it('should return allDone=true for empty plan', () => {
      const result = evaluatePlanProgress({
        steps: [],
        estimatedRounds: 1,
        complete: false,
      })
      expect(result.allDone).toBe(true)
      expect(result.ratio).toBe(1)
    })

    it('should compute correct ratio', () => {
      const plan: TaskPlan = {
        steps: [
          { id: 1, action: 'search', description: 'Q1', status: 'done' },
          { id: 2, action: 'search', description: 'Q2', status: 'pending' },
          { id: 3, action: 'synthesize', description: 'summarize', status: 'pending' },
        ],
        estimatedRounds: 2,
        complete: false,
      }

      const result = evaluatePlanProgress(plan)
      expect(result.ratio).toBeCloseTo(1 / 3)
      expect(result.pendingSteps).toHaveLength(2)
      expect(result.allDone).toBe(false)
    })

    it('should count skipped steps as done', () => {
      const plan: TaskPlan = {
        steps: [
          { id: 1, action: 'search', description: 'Q1', status: 'done' },
          { id: 2, action: 'search', description: 'Q2', status: 'skipped' },
        ],
        estimatedRounds: 1,
        complete: false,
      }

      const result = evaluatePlanProgress(plan)
      expect(result.ratio).toBe(1)
      expect(result.pendingSteps).toHaveLength(0)
      expect(result.allDone).toBe(true)
    })
  })
})
