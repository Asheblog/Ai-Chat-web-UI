export interface BuiltinSkillPreset {
  slug: string
  label: string
  description: string
  toolName: string
}

export const BUILTIN_SKILL_PRESETS: BuiltinSkillPreset[] = [
  {
    slug: 'web-search',
    label: '联网搜索',
    description: '调用搜索引擎获取最新网页信息',
    toolName: 'web_search',
  },
  {
    slug: 'python-runner',
    label: 'Python 工具',
    description: '执行 Python 代码进行计算与数据处理',
    toolName: 'python_runner',
  },
  {
    slug: 'url-reader',
    label: '网页读取',
    description: '读取网页正文，辅助联网搜索结果解析',
    toolName: 'read_url',
  },
  {
    slug: 'document-search',
    label: '会话文档检索',
    description: '检索当前会话上传的文档',
    toolName: 'document_search',
  },
  {
    slug: 'knowledge-base-search',
    label: '知识库检索',
    description: '检索系统知识库中的文档内容',
    toolName: 'kb_search',
  },
]

const PRESET_MAP = new Map<string, BuiltinSkillPreset>(
  BUILTIN_SKILL_PRESETS.map((item) => [item.slug, item]),
)

export const getBuiltinSkillPreset = (slug: string): BuiltinSkillPreset | null => {
  return PRESET_MAP.get(slug) || null
}

