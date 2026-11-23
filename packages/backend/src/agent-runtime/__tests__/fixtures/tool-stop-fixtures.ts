/**
 * 工具收尾测试共用构造器：响应形状、工具定义与工具结果。
 * 只放无断言、无副作用的纯构造器，供 soft-stop / pairing / budget 三组用例共享。
 */

export const buildNonStreamResponseLike = (content: string, usage?: Record<string, unknown>) =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: usage ?? { total_tokens: 1 },
      }),
  }) as any

export const buildToolCallTurnResponse = (
  calls: Array<{ id: string; name: string; args?: Record<string, unknown> }>,
  content = '',
) =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [
          {
            message: {
              content,
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args ?? {}),
                },
              })),
            },
          },
        ],
        usage: { total_tokens: 1 },
      }),
  }) as any

export const buildPythonToolDefinition = () =>
  ({
    type: 'function',
    function: {
      name: 'python_runner',
      description: 'Run Python',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
      },
    },
  }) as any

export const buildToolHandlerResult = (toolCallId: string, toolName = 'python_runner', content = '{"stdout":"1"}') => ({
  toolCallId,
  toolName,
  message: {
    role: 'tool' as const,
    tool_call_id: toolCallId,
    name: toolName,
    content,
  },
})

/** 带 provider 结构化结束信号的 Chat Completions turn */
export const buildNonStreamFinishResponseLike = (
  content: string,
  finishReason: string | null,
  usage?: Record<string, unknown>,
) =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: finishReason }],
        usage: usage ?? { total_tokens: 1 },
      }),
  }) as any

/** Responses API turn：status / incomplete_details / refusal 内容块 */
export const buildResponsesTurnResponseLike = (payload: {
  output: any[]
  status?: string
  incompleteReason?: string | null
}) =>
  ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        status: payload.status ?? 'completed',
        ...(payload.incompleteReason
          ? { incomplete_details: { reason: payload.incompleteReason } }
          : {}),
        output: payload.output,
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
  }) as any
