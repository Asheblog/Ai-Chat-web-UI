import { parseApiError, getFriendlyErrorMessage, type ParsedApiError } from '../api-error-parser'

describe('api-error-parser', () => {
  describe('parseApiError', () => {
    describe('上游配额限制错误 (usage_limit_reached)', () => {
      it('应该正确解析上游服务配额耗尽错误', () => {
        const errorBody = JSON.stringify({
          error: {
            type: 'usage_limit_reached',
            message: 'The usage limit has been reached',
            plan_type: 'team',
            resets_at: 1766794884,
            resets_in_seconds: 161455,
          },
        })

        const result = parseApiError({ status: 429, message: errorBody, error: errorBody })

        expect(result.type).toBe('upstream_quota')
        expect(result.message).toContain('上游服务配额已用尽')
        expect(result.message).toContain('team')
        expect(result.suggestion).toBeDefined()
        expect(result.resetInfo).toBeDefined()
        expect(result.resetInfo?.resetsAt).toBe(1766794884)
        expect(result.resetInfo?.resetsInSeconds).toBe(161455)
      })

      it('应该在错误消息中包含友好的重置时间', () => {
        const errorBody = JSON.stringify({
          error: {
            type: 'usage_limit_reached',
            message: 'The usage limit has been reached',
            resets_in_seconds: 3600, // 1小时
          },
        })

        const result = parseApiError({ status: 429, message: errorBody })

        expect(result.type).toBe('upstream_quota')
        expect(result.suggestion).toContain('1小时')
      })
    })

    describe('模型冷却错误 (model_cooldown)', () => {
      it('应该正确解析模型凭证冷却错误', () => {
        const errorBody = JSON.stringify({
          error: {
            code: 'model_cooldown',
            message: 'All credentials for model gpt-5.2 are cooling down via provider codex',
            model: 'gpt-5.2',
            provider: 'codex',
            reset_seconds: 4,
            reset_time: '4s',
          },
        })

        const result = parseApiError({ status: 429, message: errorBody, error: errorBody })

        expect(result.type).toBe('model_cooldown')
        expect(result.message).toContain('gpt-5.2')
        expect(result.message).toContain('暂时不可用')
        expect(result.suggestion).toContain('冷却')
        expect(result.resetInfo?.resetsInSeconds).toBe(4)
      })

      it('应该处理没有模型名称的冷却错误', () => {
        const errorBody = JSON.stringify({
          error: {
            code: 'model_cooldown',
            message: 'All credentials are cooling down',
          },
        })

        const result = parseApiError({ status: 429, message: errorBody })

        expect(result.type).toBe('model_cooldown')
        expect(result.message).toBe('当前模型暂时不可用')
      })
    })

    describe('普通频率限制错误', () => {
      it('应该正确解析普通429错误', () => {
        const result = parseApiError({ status: 429, message: 'Rate limit exceeded' })

        expect(result.type).toBe('rate_limit')
        expect(result.message).toBe('请求过于频繁')
        expect(result.suggestion).toContain('稍等')
      })
    })

    describe('格式化持续时间', () => {
      it('应该正确格式化秒级时间', () => {
        const errorBody = JSON.stringify({
          error: { type: 'usage_limit_reached', resets_in_seconds: 30 },
        })

        const result = parseApiError({ status: 429, message: errorBody })
        expect(result.suggestion).toContain('30秒')
      })

      it('应该正确格式化分钟级时间', () => {
        const errorBody = JSON.stringify({
          error: { type: 'usage_limit_reached', resets_in_seconds: 300 },
        })

        const result = parseApiError({ status: 429, message: errorBody })
        expect(result.suggestion).toContain('5分钟')
      })

      it('应该正确格式化小时级时间', () => {
        const errorBody = JSON.stringify({
          error: { type: 'usage_limit_reached', resets_in_seconds: 7200 },
        })

        const result = parseApiError({ status: 429, message: errorBody })
        expect(result.suggestion).toContain('2小时')
      })

      it('应该正确格式化小时和分钟组合', () => {
        const errorBody = JSON.stringify({
          error: { type: 'usage_limit_reached', resets_in_seconds: 5400 }, // 1.5小时
        })

        const result = parseApiError({ status: 429, message: errorBody })
        expect(result.suggestion).toContain('1小时30分钟')
      })
    })
  })

  describe('getFriendlyErrorMessage', () => {
    it('应该返回包含建议的完整消息', () => {
      const errorBody = JSON.stringify({
        error: {
          code: 'model_cooldown',
          message: 'All credentials for model gpt-5.2 are cooling down',
          model: 'gpt-5.2',
          reset_seconds: 10,
        },
      })

      const message = getFriendlyErrorMessage({ status: 429, message: errorBody })

      expect(message).toContain('gpt-5.2')
      expect(message).toContain('暂时不可用')
      expect(message).toContain('10秒')
    })

    it('应该处理上游配额耗尽错误', () => {
      const errorBody = JSON.stringify({
        error: {
          type: 'usage_limit_reached',
          message: 'The usage limit has been reached',
          plan_type: 'team',
        },
      })

      const message = getFriendlyErrorMessage({ status: 429, message: errorBody })

      expect(message).toContain('上游服务配额已用尽')
      expect(message).toContain('team')
    })

    it('应优先展示 Error.message，而不是 "{}"', () => {
      const message = getFriendlyErrorMessage(
        new TypeError("Cannot read properties of undefined (reading 'ok')")
      )

      expect(message).toContain("Cannot read properties of undefined (reading 'ok')")
      expect(message).not.toBe('{}')
    })
  })
})
