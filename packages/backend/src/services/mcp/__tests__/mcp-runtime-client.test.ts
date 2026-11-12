import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { HttpMcpRuntimeClient } from '../mcp-runtime-client'

interface FixtureState {
  calls: string[]
  useSse: boolean
}

const buildServer = (state: FixtureState) => {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const message = raw ? JSON.parse(raw) : null

      if (req.method === 'DELETE') {
        res.statusCode = 204
        res.end()
        return
      }

      state.calls.push(message?.method ?? 'unknown')
      if (!message || message.id === undefined) {
        res.statusCode = 202
        res.end()
        return
      }

      let result: unknown = {}
      if (message.method === 'initialize') {
        res.setHeader('mcp-session-id', 'fixture-session')
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } }
      } else if (message.method === 'tools/list') {
        result = {
          tools: [
            { name: 'echo', description: 'echos input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
            { name: 'ping', description: 'pong', inputSchema: { type: 'object', properties: {} } },
          ],
        }
      } else if (message.method === 'tools/call') {
        result = { content: [{ type: 'text', text: `echo:${message.params?.arguments?.text ?? ''}` }] }
      }

      const payload = { jsonrpc: '2.0', id: message.id, result }
      if (state.useSse) {
        res.setHeader('content-type', 'text/event-stream')
        res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(payload))
    })
  })
  return server
}

const startServer = async (useSse: boolean): Promise<{ url: string; server: http.Server; state: FixtureState }> => {
  const state: FixtureState = { calls: [], useSse }
  const server = buildServer(state)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/mcp`, server, state }
}

describe('HttpMcpRuntimeClient · streamable http', () => {
  let handle: Awaited<ReturnType<typeof startServer>>

  beforeAll(async () => {
    handle = await startServer(false)
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => handle.server.close(() => resolve()))
  })

  it('initializes, lists tools and keeps the session id', async () => {
    const client = new HttpMcpRuntimeClient({ timeoutMs: 5000 })
    const tools = await client.listTools({
      id: 1,
      transport: 'streamable_http',
      endpoint: handle.url,
      configJson: JSON.stringify({ headers: { 'x-test': '1' } }),
    })

    expect(tools.map((tool) => tool.name)).toEqual(['echo', 'ping'])
    expect(tools[0]?.inputSchema).toEqual({ type: 'object', properties: { text: { type: 'string' } } })
    expect(handle.state.calls).toEqual(
      expect.arrayContaining(['initialize', 'notifications/initialized', 'tools/list']),
    )
  })

  it('calls a tool and returns its text content', async () => {
    const client = new HttpMcpRuntimeClient({ timeoutMs: 5000 })
    const result = await client.callTool(
      { id: 1, transport: 'streamable_http', endpoint: handle.url },
      'echo',
      { text: 'hi' },
    )
    expect(result.content[0]?.text).toBe('echo:hi')
    expect(result.isError).toBe(false)
  })
})

describe('HttpMcpRuntimeClient · SSE framed responses', () => {
  let handle: Awaited<ReturnType<typeof startServer>>

  beforeAll(async () => {
    handle = await startServer(true)
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => handle.server.close(() => resolve()))
  })

  it('parses an event-stream body', async () => {
    const client = new HttpMcpRuntimeClient({ timeoutMs: 5000 })
    const tools = await client.listTools({
      id: 2,
      transport: 'streamable_http',
      endpoint: handle.url,
    })
    expect(tools).toHaveLength(2)
  })
})

describe('HttpMcpRuntimeClient · failure paths', () => {
  it('surfaces a connection error with the endpoint in the message', async () => {
    const client = new HttpMcpRuntimeClient({ timeoutMs: 2000 })
    await expect(
      client.listTools({ id: 3, transport: 'streamable_http', endpoint: 'http://127.0.0.1:1/mcp' }),
    ).rejects.toThrow(/无法连接 MCP 端点/)
  })

  it('rejects stdio without a command', async () => {
    const client = new HttpMcpRuntimeClient({ timeoutMs: 2000 })
    await expect(client.listTools({ id: 4, transport: 'stdio' })).rejects.toThrow(/缺少启动命令/)
  })
})
