import { detectExtensionPlan, parseSkillFrontmatter } from '../detector'
import type { ExtensionSourceRef, ProbeFileSet } from '../types'

const source: ExtensionSourceRef = { owner: 'acme', repo: 'demo', raw: 'acme/demo' }

const probe = (files: Record<string, string>): ProbeFileSet => ({ files, skipped: [], ref: 'main' })

describe('detectExtensionPlan', () => {
  it('detects a skill from SKILL.md frontmatter', () => {
    const result = detectExtensionPlan({
      source,
      probe: probe({ 'SKILL.md': '---\nname: PDF Helper\ndescription: 处理 PDF\n---\n# body' }),
    })
    expect(result.status).toBe('resolved')
    expect(result.plan).toMatchObject({ kind: 'skill', name: 'PDF Helper', subdir: undefined })
  })

  it('detects npm local package from server.json', () => {
    const result = detectExtensionPlan({
      source,
      probe: probe({
        'server.json': JSON.stringify({
          name: 'io.github.acme/demo',
          packages: [
            {
              registryType: 'npm',
              identifier: '@acme/mcp-demo',
              environmentVariables: [{ name: 'ACME_TOKEN', description: '访问令牌' }],
            },
          ],
        }),
      }),
    })
    expect(result.plan).toMatchObject({
      kind: 'mcp',
      sourceType: 'local_package',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@acme/mcp-demo'],
    })
    expect(result.plan?.envKeys).toEqual([{ name: 'ACME_TOKEN', reason: '访问令牌' }])
  })

  it('prefers a declared remote endpoint over a local command', () => {
    const result = detectExtensionPlan({
      source,
      probe: probe({
        'server.json': JSON.stringify({
          remotes: [{ type: 'streamable-http', url: 'https://mcp.acme.dev/mcp' }],
        }),
        'package.json': JSON.stringify({ name: 'demo', dependencies: { '@modelcontextprotocol/sdk': '^1' } }),
      }),
    })
    expect(result.plan).toMatchObject({
      kind: 'mcp',
      sourceType: 'remote',
      transport: 'streamable_http',
      endpoint: 'https://mcp.acme.dev/mcp',
    })
  })

  it('reads mcp.json command declarations', () => {
    const result = detectExtensionPlan({
      source,
      probe: probe({
        'mcp.json': JSON.stringify({
          mcpServers: { demo: { command: 'uvx', args: ['demo-mcp'], env: { DEMO_KEY: 'x' } } },
        }),
      }),
    })
    expect(result.plan).toMatchObject({ command: 'uvx', args: ['demo-mcp'] })
    expect(result.plan?.envKeys?.[0]?.name).toBe('DEMO_KEY')
  })

  it('falls back to README npx instructions', () => {
    const result = detectExtensionPlan({
      source,
      probe: probe({ 'README.md': 'Run it:\n\n npx -y @acme/demo-mcp --port 3000' }),
    })
    expect(result.plan).toMatchObject({ command: 'npx', args: ['-y', '@acme/demo-mcp'], confidence: 'medium' })
  })

  it('detects remote endpoints from README', () => {
    const result = detectExtensionPlan({
      source,
      probe: probe({ 'README.md': 'connect with mcp-remote https://mcp.acme.dev/sse' }),
    })
    expect(result.plan).toMatchObject({ sourceType: 'remote', transport: 'sse' })
  })

  it('returns ambiguous when both skill and mcp are present', () => {
    const result = detectExtensionPlan({
      source,
      probe: probe({
        'SKILL.md': '---\nname: Demo\n---',
        'package.json': JSON.stringify({ name: 'demo', dependencies: { '@modelcontextprotocol/sdk': '^1' } }),
      }),
    })
    expect(result.status).toBe('ambiguous')
    expect(result.candidates?.map((item) => item.kind).sort()).toEqual(['mcp', 'skill'])
  })

  it('honours an explicit mcp hint', () => {
    const result = detectExtensionPlan({
      source,
      probe: probe({ 'SKILL.md': '---\nname: Demo\n---' }),
      kindHint: 'mcp',
    })
    expect(result.status).toBe('unsupported')
  })

  it('reports what is missing when nothing matches', () => {
    const result = detectExtensionPlan({ source, probe: probe({ 'README.md': 'just docs' }) })
    expect(result.status).toBe('unsupported')
    expect(result.message).toContain('README.md')
  })
})

describe('parseSkillFrontmatter', () => {
  it('falls back to first heading', () => {
    expect(parseSkillFrontmatter('# My Skill\nbody').name).toBe('My Skill')
  })
})
