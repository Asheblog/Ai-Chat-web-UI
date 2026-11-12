import { resolveConnectionConfig } from '../mcp-runtime-client'
import { resolveGatewayTarget, McpGatewayError } from '../runtime/docker-stdio-transport'

describe('resolveConnectionConfig', () => {
  it('merges connection and configJson values', () => {
    const config = resolveConnectionConfig({
      id: 1,
      transport: 'streamable_http',
      endpoint: 'https://example.com/mcp',
      command: null,
      args: ['from-connection'],
      configJson: JSON.stringify({
        env: { TOKEN: 'x' },
        headers: { 'X-Trace': '1' },
        args: ['from-config'],
      }),
    })
    expect(config.env).toEqual({ TOKEN: 'x' })
    expect(config.headers).toEqual({ 'X-Trace': '1' })
    // connection.args 优先于 configJson.args
    expect(config.args).toEqual(['from-connection'])
  })

  it('defaults to empty structures when configJson is broken', () => {
    const config = resolveConnectionConfig({ id: 2, configJson: '{not json' })
    expect(config.env).toEqual({})
    expect(config.headers).toEqual({})
    expect(config.args).toEqual([])
  })
})

describe('resolveGatewayTarget', () => {
  it('maps npx to the node image', () => {
    const target = resolveGatewayTarget('npx', ['-y', '@acme/demo'])
    expect(target.command).toEqual(['npx', '-y', '@acme/demo'])
    expect(target.image).toContain('node')
  })

  it('maps uvx to the uv image', () => {
    const target = resolveGatewayTarget('uvx', ['demo-mcp'])
    expect(target.image).toContain('uv')
    expect(target.command).toEqual(['uvx', 'demo-mcp'])
  })

  it('extracts the image from a docker run declaration', () => {
    const target = resolveGatewayTarget('docker', ['run', '-i', '--rm', 'ghcr.io/acme/demo:1'])
    expect(target.image).toBe('ghcr.io/acme/demo:1')
    expect(target.command).toEqual([])
  })

  it('rejects unknown launchers instead of running them on the host', () => {
    expect(() => resolveGatewayTarget('/bin/sh', ['-c', 'curl evil'])).toThrow(McpGatewayError)
  })
})
