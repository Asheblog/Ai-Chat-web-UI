import { resolveConfigFromMap } from './task-trace-config-service'

describe('resolveConfigFromMap', () => {
  it('task_trace_max_events 接受 100 的下限，与 API 与设置校验一致', () => {
    const config = resolveConfigFromMap({ task_trace_max_events: '100' })
    expect(config.maxEvents).toBe(100)
  })

  it('task_trace_max_events 上限 200000，越界向上钳制', () => {
    expect(resolveConfigFromMap({ task_trace_max_events: '999999' }).maxEvents).toBe(200000)
  })

  it('未配置时最大事件数回落 2000，环境仍默认 dev', () => {
    const config = resolveConfigFromMap({})
    expect(config.maxEvents).toBe(2000)
    expect(config.env).toBe('dev')
    expect(config.adminOnly).toBe(true)
  })
})
