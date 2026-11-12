import YAML from 'yaml'
import type {
  DetectResult,
  ExtensionEnvRequirement,
  ExtensionKind,
  ExtensionSourceRef,
  InstallPlan,
  McpTransport,
  ProbeFileSet,
} from './types'
import { toNamespaceKey, toSourceUrl } from './source-parser'

/** 判定所需的白名单文件：一次探测全部取回，避免多轮 RTT。 */
export const DETECT_FILE_NAMES = [
  'SKILL.md',
  'skill.md',
  'server.json',
  'mcp.json',
  'smithery.yaml',
  'smithery.yml',
  'package.json',
  'pyproject.toml',
  'README.md',
  'readme.md',
]

const MAX_ENV_HINTS = 12

function safeJson(text: string | undefined): any | null {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function safeYaml(text: string | undefined): any | null {
  if (!text) return null
  try {
    const parsed = YAML.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    const trimmed = (value ?? '').trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'extension'
}

function uniqueEnv(list: ExtensionEnvRequirement[]): ExtensionEnvRequirement[] {
  const seen = new Set<string>()
  const result: ExtensionEnvRequirement[] = []
  for (const item of list) {
    const name = item.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    result.push({ name, reason: item.reason })
    if (result.length >= MAX_ENV_HINTS) break
  }
  return result
}

/** SKILL.md 的 YAML frontmatter；无 frontmatter 时退化为首个一级标题。 */
export function parseSkillFrontmatter(text: string): {
  name?: string
  description?: string
  license?: string
} {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (match) {
    const parsed = safeYaml(match[1])
    if (parsed) {
      return {
        name: typeof parsed.name === 'string' ? parsed.name : undefined,
        description: typeof parsed.description === 'string' ? parsed.description : undefined,
        license: typeof parsed.license === 'string' ? parsed.license : undefined,
      }
    }
  }
  const heading = text.match(/^#\s+(.+)$/m)
  return { name: heading?.[1]?.trim() }
}

function mapTransport(raw: string | undefined): McpTransport {
  const value = (raw ?? '').toLowerCase()
  if (value.includes('sse')) return 'sse'
  if (value.includes('stdio')) return 'stdio'
  return 'streamable_http'
}

interface LocalCandidate {
  command: string
  args: string[]
  reason: string
  confidence: 'high' | 'medium' | 'low'
  envKeys: ExtensionEnvRequirement[]
}

function fromServerJson(server: any): LocalCandidate | null {
  if (!server) return null
  const packages = Array.isArray(server.packages) ? server.packages : []
  const pkg = packages.find((item: any) => item && item.identifier) ?? null
  if (!pkg) return null
  const registry = String(pkg.registryType || pkg.registry_type || 'npm').toLowerCase()
  const identifier = String(pkg.identifier)
  const envList = Array.isArray(pkg.environmentVariables)
    ? pkg.environmentVariables.map((env: any) => ({
        name: String(env?.name || '').trim(),
        reason: String(env?.description || '清单声明的环境变量'),
      }))
    : []
  if (registry === 'pypi') {
    return {
      command: 'uvx',
      args: [identifier],
      reason: `server.json 声明 PyPI 包 ${identifier}`,
      confidence: 'high',
      envKeys: envList,
    }
  }
  return {
    command: 'npx',
    args: ['-y', identifier],
    reason: `server.json 声明 npm 包 ${identifier}`,
    confidence: 'high',
    envKeys: envList,
  }
}

function fromMcpJson(mcp: any): LocalCandidate | null {
  if (!mcp) return null
  const servers = mcp.mcpServers && typeof mcp.mcpServers === 'object' ? mcp.mcpServers : null
  if (!servers) return null
  const entry = Object.values(servers).find((item: any) => item && item.command) as any
  if (!entry) return null
  const args = Array.isArray(entry.args) ? entry.args.map(String) : []
  const envKeys = entry.env && typeof entry.env === 'object'
    ? Object.keys(entry.env).map((name) => ({ name, reason: 'mcp.json 声明' }))
    : []
  return {
    command: String(entry.command),
    args,
    reason: 'mcp.json 已声明启动命令',
    confidence: 'high',
    envKeys,
  }
}

function fromPackageJson(pkg: any): LocalCandidate | null {
  if (!pkg) return null
  const name = typeof pkg.name === 'string' ? pkg.name : ''
  if (!name) return null
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const usesSdk = Object.keys(deps).some((dep) => dep.includes('@modelcontextprotocol/sdk'))
  const hasBin = Boolean(pkg.bin)
  if (!usesSdk && !hasBin) return null
  if (!usesSdk) return null
  return {
    command: 'npx',
    args: ['-y', name],
    reason: `package.json 依赖 @modelcontextprotocol/sdk，通过 npx 运行 ${name}`,
    confidence: 'high',
    envKeys: [],
  }
}

function fromReadme(readme: string): LocalCandidate | null {
  if (!readme) return null
  const npx = readme.match(/npx\s+(?:-y\s+|--yes\s+)?(@?[A-Za-z0-9._/-]+)/)
  if (npx?.[1]) {
    return {
      command: 'npx',
      args: ['-y', npx[1]],
      reason: `README 给出 npx ${npx[1]} 的启动方式`,
      confidence: 'medium',
      envKeys: [],
    }
  }
  const uvx = readme.match(/uvx\s+([A-Za-z0-9._-]+)/)
  if (uvx?.[1]) {
    return {
      command: 'uvx',
      args: [uvx[1]],
      reason: `README 给出 uvx ${uvx[1]} 的启动方式`,
      confidence: 'medium',
      envKeys: [],
    }
  }
  const docker = readme.match(/docker\s+run\s+(?:-i\s+)?(?:--rm\s+)?([A-Za-z0-9._/:@-]+)/)
  if (docker?.[1]) {
    return {
      command: 'docker',
      args: ['run', '-i', '--rm', docker[1]],
      reason: `README 给出 docker run ${docker[1]} 的启动方式`,
      confidence: 'medium',
      envKeys: [],
    }
  }
  return null
}

function fromRemoteManifest(server: any): { url: string; transport: McpTransport } | null {
  const remotes = Array.isArray(server?.remotes) ? server.remotes : []
  const remote = remotes.find((item: any) => item && item.url)
  if (!remote) return null
  return { url: String(remote.url), transport: mapTransport(remote.type) }
}

function fromReadmeRemote(readme: string): { url: string; transport: McpTransport } | null {
  if (!readme) return null
  const bridge = readme.match(/mcp-remote\s+(https?:\/\/\S+)/)
  const direct = readme.match(/https?:\/\/[^\s)"'`]+\/mcp\b/)
  const url = bridge?.[1] ?? direct?.[0]
  if (!url) return null
  return { url: url.replace(/[).,;\]]+$/, ''), transport: /\/sse\b/.test(url) ? 'sse' : 'streamable_http' }
}

function collectReadmeEnv(readme: string): ExtensionEnvRequirement[] {
  if (!readme) return []
  const result: ExtensionEnvRequirement[] = []
  const lines = readme.split(/\r?\n/)
  for (const line of lines) {
    if (!/(env|environment|token|api[_ -]?key|secret|credential|变量)/i.test(line)) continue
    const matches = line.match(/\b([A-Z][A-Z0-9_]{2,})\b/g) || []
    for (const name of matches) {
      if (name.length > 48) continue
      result.push({ name, reason: 'README 提到的配置项' })
    }
    if (result.length >= MAX_ENV_HINTS) break
  }
  return result
}

function buildSkillPlan(
  source: ExtensionSourceRef,
  probe: ProbeFileSet,
  fileKey: string,
): InstallPlan {
  const text = probe.files[fileKey] ?? ''
  const meta = parseSkillFrontmatter(text)
  const subdirBase = source.subdir ? source.subdir.split('/').pop() : undefined
  const name = firstNonEmpty(meta.name, subdirBase, source.repo) ?? source.repo
  return {
    kind: 'skill',
    name,
    slug: slugify(firstNonEmpty(subdirBase, meta.name, source.repo) ?? source.repo),
    confidence: 'high',
    reason: `仓库内找到 ${fileKey}，按 Skill 安装${meta.description ? `（${meta.description.slice(0, 80)}）` : ''}`,
    source,
    sourceUrl: toSourceUrl(source),
    subdir: source.subdir,
  }
}

function buildMcpPlan(
  source: ExtensionSourceRef,
  parts: { server: any; mcpJson: any; packageJson: any; readme?: string },
): InstallPlan | null {
  const remote = fromRemoteManifest(parts.server) ?? fromReadmeRemote(parts.readme ?? '')
  const local =
    fromServerJson(parts.server) ??
    fromMcpJson(parts.mcpJson) ??
    fromPackageJson(parts.packageJson) ??
    fromReadme(parts.readme ?? '')

  const manifestName = firstNonEmpty(
    typeof parts.server?.name === 'string' ? parts.server.name.split('/').pop() : undefined,
    typeof parts.packageJson?.name === 'string' ? parts.packageJson.name : undefined,
    source.subdir ? source.subdir.split('/').pop() : undefined,
    source.repo,
  ) ?? source.repo

  const base = {
    kind: 'mcp' as ExtensionKind,
    name: manifestName,
    slug: slugify(manifestName),
    source,
    sourceUrl: toSourceUrl(source),
  }

  if (remote) {
    return {
      ...base,
      confidence: 'high',
      reason: `识别到远程 MCP 端点 ${remote.url}`,
      sourceType: 'remote',
      transport: remote.transport,
      endpoint: remote.url,
      envKeys: uniqueEnv([
        ...(local?.envKeys ?? []),
        ...collectReadmeEnv(parts.readme ?? ''),
      ]),
    }
  }

  if (local) {
    return {
      ...base,
      confidence: local.confidence,
      reason: local.reason,
      sourceType: 'local_package',
      transport: 'stdio',
      command: local.command,
      args: local.args,
      envKeys: uniqueEnv([...local.envKeys, ...collectReadmeEnv(parts.readme ?? '')]),
    }
  }

  return null
}

/**
 * 判定入口：仓库内容 → InstallPlan。
 * kindHint 显式指定时以用户意图为准，不再自动猜测。
 */
export function detectExtensionPlan(input: {
  source: ExtensionSourceRef
  probe: ProbeFileSet
  kindHint?: 'auto' | 'skill' | 'mcp'
}): DetectResult {
  const { source, probe } = input
  const probed = Object.keys(probe.files)
  const skillKey = probe.files['SKILL.md'] ? 'SKILL.md' : probe.files['skill.md'] ? 'skill.md' : null
  const server = safeJson(probe.files['server.json'])
  const mcpJson = safeJson(probe.files['mcp.json'])
  const packageJson = safeJson(probe.files['package.json'])
  const readme = probe.files['README.md'] ?? probe.files['readme.md']
  const yamlManifest = safeYaml(probe.files['smithery.yaml'] ?? probe.files['smithery.yml'])

  const kindHint = input.kindHint ?? 'auto'

  if (kindHint === 'skill') {
    if (!skillKey) {
      return {
        status: 'unsupported',
        message: `指定按 Skill 安装，但${source.subdir ? `子目录 ${source.subdir}` : '仓库根目录'}没有 SKILL.md`,
        probed,
      }
    }
    return { status: 'resolved', plan: buildSkillPlan(source, probe, skillKey), probed }
  }

  const mcpPlan = buildMcpPlan(source, {
    server,
    mcpJson: mcpJson ?? (yamlManifest?.startCommand ? { mcpServers: { main: { command: yamlManifest.startCommand.command, args: yamlManifest.startCommand.args } } } : null),
    packageJson,
    readme,
  })

  if (kindHint === 'mcp') {
    if (!mcpPlan) {
      return {
        status: 'unsupported',
        message: '指定按 MCP 安装，但没找到 server.json / mcp.json / 含 MCP SDK 依赖的 package.json / README 启动说明',
        probed,
      }
    }
    return { status: 'resolved', plan: mcpPlan, probed }
  }

  const skillPlan = skillKey ? buildSkillPlan(source, probe, skillKey) : null

  if (skillPlan && mcpPlan) {
    return {
      status: 'ambiguous',
      candidates: [mcpPlan, skillPlan],
      message: '该仓库同时包含 MCP 服务与 Skill，先确认用户要装哪一个',
      probed,
    }
  }
  if (skillPlan) return { status: 'resolved', plan: skillPlan, probed }
  if (mcpPlan) return { status: 'resolved', plan: mcpPlan, probed }

  return {
    status: 'unsupported',
    message: probed.length === 0
      ? '没有读到任何可识别的文件（SKILL.md / server.json / mcp.json / package.json / README）'
      : `读到 ${probed.join('、')}，但都不含 MCP 或 Skill 的安装信息`,
    probed,
  }
}
