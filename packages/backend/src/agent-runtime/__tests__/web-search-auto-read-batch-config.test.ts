import { buildAgentWebSearchConfig } from '../agent-tool-config'
import { parseSystemSettingsPayload } from '@aichat/shared/settings-codec'
import { serializeSystemSettingsPatch } from '@aichat/shared'

describe('buildAgentWebSearchConfig auto-read batch deadline', () => {
  test('reads the batch deadline from system settings', () => {
    const config = buildAgentWebSearchConfig({ web_search_auto_read_batch_timeout_ms: '21000' }, {})

    expect(config.autoReadBatchTimeoutMs).toBe(21000)
    // 单 URL 超时的既有含义不变
    expect(config.autoReadTimeoutMs).toBe(18000)
  })

  test('reads the batch deadline from the environment and defaults to 18 seconds', () => {
    expect(buildAgentWebSearchConfig({}, {}).autoReadBatchTimeoutMs).toBe(18000)
    expect(
      buildAgentWebSearchConfig({}, { WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS: '9000' }).autoReadBatchTimeoutMs,
    ).toBe(9000)
  })

  test('keeps the batch deadline and the per-url timeout independent', () => {
    const config = buildAgentWebSearchConfig(
      { web_search_auto_read_timeout_ms: '45000', web_search_auto_read_batch_timeout_ms: '20000' },
      {},
    )

    expect(config.autoReadTimeoutMs).toBe(45000)
    expect(config.autoReadBatchTimeoutMs).toBe(20000)
  })

  test('round trips the batch deadline through the shared settings codec', () => {
    const parsed = parseSystemSettingsPayload({ web_search_auto_read_batch_timeout_ms: 24000 })
    expect(parsed.webSearchAutoReadBatchTimeoutMs).toBe(24000)
    expect(serializeSystemSettingsPatch({ webSearchAutoReadBatchTimeoutMs: 21000 })).toMatchObject({
      web_search_auto_read_batch_timeout_ms: 21000,
    })
  })

  test('clamps the batch deadline into the accepted range', () => {
    expect(
      buildAgentWebSearchConfig({ web_search_auto_read_batch_timeout_ms: '10' }, {}).autoReadBatchTimeoutMs,
    ).toBe(3000)
    expect(
      buildAgentWebSearchConfig({ web_search_auto_read_batch_timeout_ms: '999999' }, {}).autoReadBatchTimeoutMs,
    ).toBe(120000)
  })
})
