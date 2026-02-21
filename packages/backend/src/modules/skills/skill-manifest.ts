import { z } from 'zod'
import YAML from 'yaml'
import type { SkillManifest } from './types'

const runtimeSchema = z.object({
  type: z.enum(['node', 'python', 'shell', 'powershell', 'cmd']),
  command: z.string().min(1).max(256).optional(),
  args: z.array(z.string().min(1).max(256)).max(32).optional(),
  env: z.record(z.string().max(4096)).optional(),
  timeout_ms: z.number().int().min(1000).max(120000).optional(),
  max_output_chars: z.number().int().min(256).max(200000).optional(),
})

const toolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(4000),
  input_schema: z.record(z.unknown()),
  aliases: z.array(z.string().min(1).max(128)).max(10).optional(),
})

const manifestSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  version: z.string().min(1).max(64),
  entry: z.string().min(1).max(512),
  tools: z.array(toolSchema).min(1).max(32),
  python_packages: z.array(z.string().min(1).max(256)).max(128).optional(),
  capabilities: z.array(z.string().min(1).max(128)).max(64).default([]),
  runtime: runtimeSchema,
  permissions: z.array(z.string().min(1).max(128)).max(64).default([]),
  platforms: z.array(z.string().min(1).max(64)).min(1).max(8),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
})

export class SkillManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillManifestError'
  }
}

export function parseSkillManifestText(raw: string, sourceName: string): SkillManifest {
  if (!raw || !raw.trim()) {
    throw new SkillManifestError(`Skill manifest is empty: ${sourceName}`)
  }

  let parsed: unknown
  try {
    parsed = YAML.parse(raw)
  } catch (error) {
    throw new SkillManifestError(
      `Failed to parse skill manifest (${sourceName}): ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const result = manifestSchema.safeParse(parsed)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new SkillManifestError(`Invalid skill manifest (${sourceName}): ${details}`)
  }

  const normalized = result.data
  const toolNames = new Set<string>()
  for (const tool of normalized.tools) {
    const key = tool.name.trim().toLowerCase()
    if (toolNames.has(key)) {
      throw new SkillManifestError(`Duplicate tool name in manifest (${sourceName}): ${tool.name}`)
    }
    toolNames.add(key)
  }

  return normalized as SkillManifest
}
