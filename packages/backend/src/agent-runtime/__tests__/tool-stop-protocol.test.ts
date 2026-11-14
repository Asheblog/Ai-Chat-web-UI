import {
  buildAbortedToolResultMessages,
  buildSkippedToolSummary,
  buildToolRequest,
} from '../tool-protocol'
import { buildPythonToolDefinition } from './fixtures/tool-stop-fixtures'

describe('skipped tool call copy', () => {
  it('words the unexecuted call by reason instead of calling a budget stop a stop', () => {
    expect(buildSkippedToolSummary('stop_tools')).toBe('已停止后续工具，未执行')
    expect(buildSkippedToolSummary('budget_exhausted')).toBe('工具预算已用尽，未执行该调用')
  })

  it('carries the same reason-specific copy into the paired tool result', () => {
    const [stopResult] = buildAbortedToolResultMessages({
      schema: 'tools',
      toolCalls: [{ id: 'call_stop', function: { name: 'web_search', arguments: '{}' } }],
      reason: 'stop_tools',
    })
    expect(JSON.parse(stopResult.content)).toMatchObject({
      status: 'aborted',
      reason: 'stop_tools',
      error: '已停止后续工具，未执行',
    })

    const [budgetResult] = buildAbortedToolResultMessages({
      schema: 'tools',
      toolCalls: [{ id: 'call_budget', function: { name: 'web_search', arguments: '{}' } }],
      reason: 'budget_exhausted',
    })
    expect(JSON.parse(budgetResult.content)).toMatchObject({
      status: 'aborted',
      reason: 'budget_exhausted',
      error: '工具预算已用尽，未执行该调用',
    })
  })
})

describe('buildToolRequest without tool definitions', () => {
  it('omits tools and tool_choice so the closing turn carries no tools', () => {
    const built = buildToolRequest({
      requestData: {},
      messages: [{ role: 'user', content: 'hi' }],
      toolDefinitions: [],
      schema: 'tools',
      provider: 'openai',
    })
    expect(built.body.tools).toBeUndefined()
    expect(built.body.tool_choice).toBeUndefined()
    expect(built.body.parallel_tool_calls).toBeUndefined()
  })

  it('omits functions and function_call for the legacy schema', () => {
    const built = buildToolRequest({
      requestData: {},
      messages: [{ role: 'user', content: 'hi' }],
      toolDefinitions: [],
      schema: 'functions',
      provider: 'openai',
    })
    expect(built.body.functions).toBeUndefined()
    expect(built.body.function_call).toBeUndefined()
  })

  it('drops the text-protocol tool prompt on a tool-free closing turn', () => {
    // 真实 inject/build 路径：第 1 轮注入工具协议，chat 侧把注入后的 messages 写回 workingMessages
    const first = buildToolRequest({
      requestData: { tool_schema: 'text' },
      messages: [{ role: 'user', content: '查一下' }],
      toolDefinitions: [buildPythonToolDefinition()],
      schema: 'text',
      provider: 'anthropic',
    })
    expect(first.textPromptAdded).toBe(true)
    expect(
      first.messages.some(
        (message: any) =>
          message?.role === 'system' && String(message?.content).includes('工具调用协议(XML):'),
      ),
    ).toBe(true)

    // 收尾轮：body 不带工具，messages 里也不能再留"可用工具格式"
    const closing = buildToolRequest({
      requestData: { tool_schema: 'text' },
      messages: first.messages,
      toolDefinitions: [],
      schema: 'text',
      provider: 'anthropic',
    })

    expect(closing.textPromptAdded).toBe(true)
    expect(
      closing.messages.some((message: any) => String(message?.content).includes('工具调用协议(XML):')),
    ).toBe(false)
    expect(
      closing.messages.some((message: any) => String(message?.content).includes('没有可用工具')),
    ).toBe(true)
    // 替换而不是新增：system 消息数量不增
    expect(closing.messages.filter((message: any) => message?.role === 'system')).toHaveLength(1)
  })

  it('keeps sending tools when definitions are present', () => {
    const built = buildToolRequest({
      requestData: {},
      messages: [{ role: 'user', content: 'hi' }],
      toolDefinitions: [buildPythonToolDefinition()],
      schema: 'tools',
      provider: 'openai',
    })
    expect(Array.isArray(built.body.tools)).toBe(true)
    expect(built.body.tool_choice).toBe('auto')
  })
})
