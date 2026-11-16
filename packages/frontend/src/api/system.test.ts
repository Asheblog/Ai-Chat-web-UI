// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'

const client = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/api/http', () => ({ apiHttpClient: client }))
import { exportTaskTrace } from './system'

describe('task trace download', () => {
  beforeEach(() => vi.clearAllMocks())

  test('returns the complete trace attachment unchanged', async () => {
    const attachment = new Blob(['--- Events ---\n1 completed'])
    client.get.mockResolvedValue({ data: attachment })
    expect(await exportTaskTrace(105)).toBe(attachment)
    expect(client.get).toHaveBeenCalledWith('/task-trace/105/export', { responseType: 'blob' })
  })

  test('shows the server reason when a missing trace returns a JSON blob', async () => {
    const failure = Object.assign(new Error('Request failed with status code 409'), {
      response: { data: new Blob([JSON.stringify({ error: '追踪事件文件缺失，请检查持久化卷。' })], { type: 'application/json' }) },
    })
    client.get.mockRejectedValue(failure)
    await expect(exportTaskTrace(104)).rejects.toThrow('追踪事件文件缺失，请检查持久化卷。')
  })

  test('preserves a transport error when there is no JSON response', async () => {
    const failure = new Error('Network Error')
    client.get.mockRejectedValue(failure)
    await expect(exportTaskTrace(104)).rejects.toBe(failure)
  })

  test('preserves the original error for malformed JSON attachments', async () => {
    const failure = Object.assign(new Error('Request failed with status code 502'), {
      response: { data: new Blob(['upstream unavailable'], { type: 'text/plain' }) },
    })
    client.get.mockRejectedValue(failure)
    await expect(exportTaskTrace(104)).rejects.toBe(failure)
  })
})
