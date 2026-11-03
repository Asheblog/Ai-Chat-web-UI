import { buildAgentWebSearchConfig, buildAgentUrlReaderConfig } from '../agent-tool-config'
import { parseSystemSettingsPayload } from '@aichat/shared/settings-codec'
import { serializeSystemSettingsPatch } from '@aichat/shared'

describe('DeepSeek search configuration', () => {
  test('accepts the fifth engine and keeps its independent credential and fetch toggle', () => {
    const settings = { web_search_enabled_engines: '["deepseek"]', web_search_api_key_deepseek: 'dedicated-key', web_search_deepseek_fetch_enable: 'true', web_search_parallel_max_engines: '5' }
    expect(buildAgentWebSearchConfig(settings, {})).toMatchObject({ engines: ['deepseek'], apiKeys: { deepseek: 'dedicated-key' }, parallelMaxEngines: 5, deepseekFetchEnabled: true })
    expect(buildAgentUrlReaderConfig(settings, {})).toMatchObject({ enableDeepseekFallback: true, deepseekApiKey: 'dedicated-key' })
  })

  test('defaults to disabled Fetch and does not select DeepSeek automatically', () => {
    expect(buildAgentWebSearchConfig({}, {})).toMatchObject({ engines: ['tavily'], deepseekFetchEnabled: false, parallelMaxEngines: 3 })
    expect(buildAgentUrlReaderConfig({}, {})).toMatchObject({ enableDeepseekFallback: false })
  })

  test('an explicitly unavailable runtime credential cannot fall back to an environment key', () => {
    const settings = { web_search_api_key_deepseek: '', web_search_enabled_engines: '["brave","deepseek"]', web_search_api_key_brave: 'brave-key' }
    const env = { WEB_SEARCH_API_KEY_DEEPSEEK: 'environment-key' }
    expect(buildAgentWebSearchConfig(settings, env).apiKeys).toEqual({ brave: 'brave-key' })
    expect(buildAgentUrlReaderConfig(settings, env).deepseekApiKey).toBeUndefined()
  })

  test('round trips the new settings without exposing a write-only key on reads', () => {
    const result = parseSystemSettingsPayload({ web_search_enabled_engines: ['deepseek'], web_search_has_api_key_deepseek: true, web_search_api_key_deepseek: 'must-not-read', web_search_deepseek_fetch_enable: true, web_search_parallel_max_engines: 5 })
    expect(result).toMatchObject({ webSearchEnabledEngines: ['deepseek'], webSearchHasApiKeyDeepseek: true, webSearchHasApiKey: true, webSearchDeepseekFetchEnable: true, webSearchParallelMaxEngines: 5 })
    expect(result).not.toHaveProperty('webSearchApiKeyDeepseek')
    expect(serializeSystemSettingsPatch({ webSearchApiKeyDeepseek: 'new-key', webSearchDeepseekFetchEnable: true })).toMatchObject({ web_search_api_key_deepseek: 'new-key', web_search_deepseek_fetch_enable: true })
  })
})
