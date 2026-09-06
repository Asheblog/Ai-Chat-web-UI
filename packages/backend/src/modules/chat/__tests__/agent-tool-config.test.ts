import { buildAgentVisionProxyConfig, computeAgentToolFlags } from '../../../agent-runtime/agent-tool-config'
import type { AgentWebSearchConfig, AgentPythonToolConfig, AgentWorkspaceToolConfig, AgentUrlReaderConfig } from '../../../agent-runtime/agent-tool-config'
import { BUILTIN_SKILL_SLUGS } from '../../skills/types'

const webSearchConfig: AgentWebSearchConfig = {
  enabled: true, engines: ['tavily'], engineOrder: ['tavily'], apiKeys: { tavily: 'k' },
  resultLimit: 5, domains: [], parallelMaxEngines: 2, parallelMaxQueriesPerCall: 1,
  parallelTimeoutMs: 15000, mergeStrategy: 'hybrid_score_v1', autoBilingual: false,
  autoBilingualMode: 'off',
}
const pythonToolConfig: AgentPythonToolConfig = { enabled: true, timeoutMs: 60000, maxOutputChars: 20000, maxSourceChars: 20000 }
const workspaceToolConfig: AgentWorkspaceToolConfig = { enabled: true, listMaxEntries: 50, readMaxChars: 20000, gitCloneTimeoutMs: 60000 }
const urlReaderConfig = { enabled: true, timeout: 30000 } as unknown as AgentUrlReaderConfig

describe('buildAgentVisionProxyConfig', () => {
  it('parses sysMap', () => {
    const cfg = buildAgentVisionProxyConfig({
      image_transcription_enabled: 'true',
      image_transcription_connection_id: '2',
      image_transcription_model_id: 'gemini-2.5-flash',
    })
    expect(cfg).toEqual({
      enabled: true,
      connectionId: 2,
      modelId: 'gemini-2.5-flash',
      reasoningEnabled: false,
      reasoningEffort: '',
    })
  })
  it('disabled when absent', () => {
    expect(buildAgentVisionProxyConfig({}).enabled).toBe(false)
  })
})

describe('computeAgentToolFlags', () => {
  const base = {
    sysMap: {},
    requestedSkills: { builtin: [], enabled: [] } as any,
    hasKnowledgeBases: false,
    webSearchConfig,
    pythonToolConfig,
    workspaceToolConfig,
    urlReaderConfig,
  }

  it('no tools active by default', () => {
    const flags = computeAgentToolFlags(base)
    expect(flags.agentToolsActive).toBe(false)
  })

  it('web search active when requested and configured', () => {
    const flags = computeAgentToolFlags({
      ...base,
      requestedSkills: { builtin: [BUILTIN_SKILL_SLUGS.WEB_SEARCH], enabled: [] } as any,
    })
    expect(flags.agentWebSearchActive).toBe(true)
    expect(flags.agentToolsActive).toBe(true)
  })

  it('web search inactive when no api keys', () => {
    const flags = computeAgentToolFlags({
      ...base,
      webSearchConfig: { ...webSearchConfig, apiKeys: {} },
      requestedSkills: { builtin: [BUILTIN_SKILL_SLUGS.WEB_SEARCH], enabled: [] } as any,
    })
    expect(flags.agentWebSearchActive).toBe(false)
  })

  it('url reader active when requested', () => {
    const flags = computeAgentToolFlags({
      ...base,
      requestedSkills: { builtin: [BUILTIN_SKILL_SLUGS.URL_READER], enabled: [] } as any,
    })
    expect(flags.urlReaderActive).toBe(true)
  })

  it('deep research activates web search, url reader and pdf export', () => {
    const flags = computeAgentToolFlags({
      ...base,
      requestedSkills: { builtin: [BUILTIN_SKILL_SLUGS.DEEP_RESEARCH], enabled: [] } as any,
    })
    expect(flags.deepResearchSkillRequested).toBe(true)
    expect(flags.agentWebSearchActive).toBe(true)
    expect(flags.urlReaderActive).toBe(true)
    expect(flags.pdfExportActive).toBe(true)
    expect(flags.agentToolsActive).toBe(true)
  })

  it('deep research stays tool-active even when no search engine keys exist', () => {
    const flags = computeAgentToolFlags({
      ...base,
      webSearchConfig: { ...webSearchConfig, apiKeys: {} },
      requestedSkills: { builtin: [BUILTIN_SKILL_SLUGS.DEEP_RESEARCH], enabled: [] } as any,
    })
    expect(flags.agentWebSearchActive).toBe(false)
    expect(flags.pdfExportActive).toBe(true)
    expect(flags.agentToolsActive).toBe(true)
  })

  it('dynamic skill requires runtime enabled', () => {
    const flags = computeAgentToolFlags({
      ...base,
      sysMap: { chat_dynamic_skill_runtime_enabled: 'false' },
      requestedSkills: { builtin: [], enabled: [{ skillId: 1 }] } as any,
    })
    expect(flags.dynamicSkillRequested).toBe(false)
    const flags2 = computeAgentToolFlags({
      ...base,
      sysMap: { chat_dynamic_skill_runtime_enabled: 'true' },
      requestedSkills: { builtin: [], enabled: [{ skillId: 1 }] } as any,
    })
    expect(flags2.dynamicSkillRequested).toBe(true)
    expect(flags2.agentToolsActive).toBe(true)
  })
})
