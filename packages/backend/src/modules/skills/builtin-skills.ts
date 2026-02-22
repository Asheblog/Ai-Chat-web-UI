import type { PrismaClient } from '@prisma/client'
import type { SkillRiskLevel } from './types'

export const BUILTIN_SKILL_VERSION = 'builtin-1.0.0'

export interface BuiltinSkillTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface BuiltinSkillDefinition {
  slug: string
  displayName: string
  description: string
  riskLevel: SkillRiskLevel
  tools: BuiltinSkillTool[]
  pythonPackages: string[]
}

const PYTHON_RUNNER_DEFAULT_PACKAGES: string[] = [
  'numpy',
  'sympy',
  'scipy',
  'statsmodels',
  'networkx',
  'scikit-learn',
  'matplotlib',
  'pandas',
  'pulp',
]

export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
  {
    slug: 'web-search',
    displayName: 'Web Search',
    description: '内置联网搜索能力',
    riskLevel: 'medium',
    pythonPackages: [],
    tools: [
      {
        name: 'web_search',
        description: 'Search the web for up-to-date information.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
    ],
  },
  {
    slug: 'python-runner',
    displayName: 'Python Runner',
    description: '内置 Python 执行能力',
    riskLevel: 'high',
    pythonPackages: [...PYTHON_RUNNER_DEFAULT_PACKAGES],
    tools: [
      {
        name: 'python_runner',
        description: 'Run deterministic Python snippets.',
        input_schema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Python source code' },
          },
          required: ['code'],
        },
      },
    ],
  },
  {
    slug: 'url-reader',
    displayName: 'URL Reader',
    description: '内置网页正文读取能力',
    riskLevel: 'medium',
    pythonPackages: [],
    tools: [
      {
        name: 'read_url',
        description: 'Read and extract text from a URL.',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to read' },
          },
          required: ['url'],
        },
      },
    ],
  },
  {
    slug: 'document-search',
    displayName: 'Document Search',
    description: '会话文档检索能力',
    riskLevel: 'low',
    pythonPackages: [],
    tools: [
      {
        name: 'document_list',
        description: 'List attached documents.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'document_search',
        description: 'Search within attached documents.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'document_get_content',
        description: 'Get full document content.',
        input_schema: {
          type: 'object',
          properties: { document_id: { type: 'number' } },
          required: ['document_id'],
        },
      },
      {
        name: 'document_get_toc',
        description: 'Get document table of contents.',
        input_schema: {
          type: 'object',
          properties: { document_id: { type: 'number' } },
          required: ['document_id'],
        },
      },
      {
        name: 'document_get_section',
        description: 'Get a section from document.',
        input_schema: {
          type: 'object',
          properties: {
            document_id: { type: 'number' },
            section_id: { type: 'string' },
          },
          required: ['document_id', 'section_id'],
        },
      },
    ],
  },
  {
    slug: 'knowledge-base-search',
    displayName: 'Knowledge Base Search',
    description: '知识库检索能力',
    riskLevel: 'low',
    pythonPackages: [],
    tools: [
      {
        name: 'kb_search',
        description: 'Search in knowledge bases.',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        name: 'kb_get_documents',
        description: 'List knowledge base documents.',
        input_schema: {
          type: 'object',
          properties: { kb_id: { type: 'number' } },
          required: ['kb_id'],
        },
      },
      {
        name: 'kb_get_document_content',
        description: 'Get knowledge base document content.',
        input_schema: {
          type: 'object',
          properties: { document_id: { type: 'number' } },
          required: ['document_id'],
        },
      },
      {
        name: 'kb_get_toc',
        description: 'Get knowledge base document TOC.',
        input_schema: {
          type: 'object',
          properties: { document_id: { type: 'number' } },
          required: ['document_id'],
        },
      },
      {
        name: 'kb_get_section',
        description: 'Get section from knowledge base document.',
        input_schema: {
          type: 'object',
          properties: {
            document_id: { type: 'number' },
            section_id: { type: 'string' },
          },
          required: ['document_id', 'section_id'],
        },
      },
    ],
  },
]

export function buildBuiltinManifest(skill: BuiltinSkillDefinition) {
  return {
    id: skill.slug,
    name: skill.displayName,
    version: BUILTIN_SKILL_VERSION,
    entry: 'builtin',
    tools: skill.tools,
    python_packages: skill.pythonPackages,
    capabilities: ['builtin'],
    runtime: {
      type: 'node',
      command: 'builtin',
      args: [],
      timeout_ms: 30_000,
      max_output_chars: 20_000,
    },
    permissions: [],
    platforms: ['linux', 'windows', 'darwin'],
    risk_level: skill.riskLevel,
  }
}

export async function syncBuiltinSkills(
  prisma: PrismaClient,
  options?: {
    now?: Date
  },
): Promise<void> {
  const now = options?.now ?? new Date()

  for (const skill of BUILTIN_SKILLS) {
    const manifest = buildBuiltinManifest(skill)

    const skillRow = await prisma.skill.upsert({
      where: { slug: skill.slug },
      update: {
        displayName: skill.displayName,
        description: skill.description,
        sourceType: 'builtin',
        sourceUrl: `builtin://${skill.slug}`,
        status: 'active',
      },
      create: {
        slug: skill.slug,
        displayName: skill.displayName,
        description: skill.description,
        sourceType: 'builtin',
        sourceUrl: `builtin://${skill.slug}`,
        status: 'active',
      },
    })

    const versionRow = await prisma.skillVersion.upsert({
      where: {
        skillId_version: {
          skillId: skillRow.id,
          version: BUILTIN_SKILL_VERSION,
        },
      },
      update: {
        status: 'active',
        riskLevel: skill.riskLevel,
        entry: manifest.entry,
        manifestJson: JSON.stringify(manifest),
        approvedAt: now,
        activatedAt: now,
      },
      create: {
        skillId: skillRow.id,
        version: BUILTIN_SKILL_VERSION,
        status: 'active',
        riskLevel: skill.riskLevel,
        entry: manifest.entry,
        manifestJson: JSON.stringify(manifest),
        packageHash: `builtin:${skill.slug}:${BUILTIN_SKILL_VERSION}`,
        sourceRef: 'builtin',
        approvedAt: now,
        activatedAt: now,
      },
    })

    await prisma.skill.update({
      where: { id: skillRow.id },
      data: {
        defaultVersionId: versionRow.id,
        status: 'active',
      },
    })

    await prisma.skillBinding.upsert({
      where: {
        skillId_scopeType_scopeId: {
          skillId: skillRow.id,
          scopeType: 'system',
          scopeId: 'global',
        },
      },
      update: {
        versionId: versionRow.id,
        enabled: true,
        policyJson: '{}',
        overridesJson: '{}',
      },
      create: {
        skillId: skillRow.id,
        versionId: versionRow.id,
        scopeType: 'system',
        scopeId: 'global',
        enabled: true,
        policyJson: '{}',
        overridesJson: '{}',
      },
    })
  }
}
