import { InstallExtensionToolHandler } from '../install-extension-handler'
import type { ToolCallContext } from '../../../../agent-runtime/tool-handler-types'

const buildContext = (overrides: Partial<ToolCallContext> = {}): ToolCallContext => ({
  sessionId: 42,
  actorUserId: 7,
  emitReasoning: jest.fn(),
  sendToolEvent: jest.fn(),
  ...overrides,
})

const buildHandler = (outcome: unknown, enabled = true) => {
  const installFromSource = jest.fn().mockResolvedValue(outcome)
  const handler = new InstallExtensionToolHandler({
    enabled,
    service: { installFromSource } as any,
  })
  return { handler, installFromSource }
}

describe('InstallExtensionToolHandler', () => {
  it('exposes a tool definition with a required source', () => {
    const { handler } = buildHandler({ ok: true })
    expect(handler.toolName).toBe('install_extension')
    expect(handler.toolDefinition.function.parameters.required).toEqual(['source'])
    expect(handler.canHandle('install_extension')).toBe(true)
    expect(handler.canHandle('other')).toBe(false)
  })

  it('rejects a missing source without calling the service', async () => {
    const { handler, installFromSource } = buildHandler({ ok: true })
    const result = await handler.handle({ id: 'c1' } as any, {}, buildContext())
    expect(installFromSource).not.toHaveBeenCalled()
    expect(result.message.content).toContain('缺少 source')
  })

  it('requires a logged-in actor', async () => {
    const { handler, installFromSource } = buildHandler({ ok: true })
    const result = await handler.handle(
      { id: 'c1' } as any,
      { source: 'acme/demo' },
      buildContext({ actorUserId: null }),
    )
    expect(installFromSource).not.toHaveBeenCalled()
    expect(result.message.content).toContain('需要登录')
  })

  it('returns the install outcome and emits progress events', async () => {
    const outcome = { ok: true, status: 'ready', plan: { kind: 'mcp' }, tools: [{ name: 'a' }] }
    const { handler, installFromSource } = buildHandler(outcome)
    const context = buildContext()
    const result = await handler.handle(
      { id: 'c1' } as any,
      { source: 'https://github.com/acme/demo', kind: 'mcp', scope: 'system' },
      context,
    )

    expect(installFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'https://github.com/acme/demo', kindHint: 'mcp', scope: 'system' }),
    )
    expect(JSON.parse(result.message.content)).toMatchObject({ ok: true, status: 'ready' })
    const stages = (context.sendToolEvent as jest.Mock).mock.calls.map((call) => call[0].stage)
    expect(stages).toContain('start')
    expect(stages).toContain('end')
  })

  it('reports a disabled tool', async () => {
    const { handler } = buildHandler({ ok: true }, false)
    const result = await handler.handle({ id: 'c1' } as any, { source: 'acme/demo' }, buildContext())
    expect(result.message.content).toContain('已被管理员关闭')
  })

  it('turns unexpected errors into a tool error event', async () => {
    const handler = new InstallExtensionToolHandler({
      enabled: true,
      service: { installFromSource: jest.fn().mockRejectedValue(new Error('boom')) } as any,
    })
    const context = buildContext()
    const result = await handler.handle({ id: 'c1' } as any, { source: 'acme/demo' }, context)
    expect(JSON.parse(result.message.content)).toMatchObject({ ok: false, error: 'boom' })
    const lastEvent = (context.sendToolEvent as jest.Mock).mock.calls.at(-1)?.[0]
    expect(lastEvent.stage).toBe('error')
  })
})
