import { beforeEach, describe, expect, test, vi } from 'vitest'

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}))

vi.mock('@/api/http', () => ({ apiHttpClient: clientMock }))

import { updateSystemSettings } from './settings'

describe('updateSystemSettings DeepSeek 字段转发', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientMock.get.mockResolvedValue({ data: { success: true, data: {} } })
    clientMock.put.mockResolvedValue({ data: { success: true, data: {} } })
  })

  const requestBody = () => clientMock.put.mock.calls[0][1] as Record<string, unknown>

  test('DeepSeek Key 留空不产生字段，保留服务端原值', async () => {
    await updateSystemSettings({ webSearchResultLimit: 5 })

    expect(clientMock.put).toHaveBeenCalledWith('/settings/system', expect.any(Object))
    expect(requestBody()).not.toHaveProperty('web_search_api_key_deepseek')
  })

  test('显式清除保留空字符串，Fetch 布尔值同步转发', async () => {
    await updateSystemSettings({
      webSearchApiKeyDeepseek: '',
      webSearchDeepseekFetchEnable: true,
    })

    expect(requestBody()).toEqual(
      expect.objectContaining({
        web_search_api_key_deepseek: '',
        web_search_deepseek_fetch_enable: true,
      }),
    )
    expect(requestBody()).not.toHaveProperty('web_search_result_limit')
  })

  test('forwards automatic output limits and the writable tool policies', async () => {
    await updateSystemSettings({ reasoningMaxOutputTokensDefault: 0, extensionInstallToolEnable: false, webSearchAutoReadBatchTimeoutMs: 25000 })
    expect(requestBody()).toMatchObject({ reasoning_max_output_tokens_default: 0, extension_install_tool_enable: false, web_search_auto_read_batch_timeout_ms: 25000 })
  })

  test('新 Key 原样转发，不裁剪为省略', async () => {
    await updateSystemSettings({
      webSearchApiKeyDeepseek: 'sk-deepseek-test',
      webSearchDeepseekFetchEnable: false,
    })

    expect(requestBody()).toEqual(
      expect.objectContaining({
        web_search_api_key_deepseek: 'sk-deepseek-test',
        web_search_deepseek_fetch_enable: false,
      }),
    )
  })
})
