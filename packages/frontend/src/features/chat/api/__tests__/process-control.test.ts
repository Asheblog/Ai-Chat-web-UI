import { beforeEach, describe, expect, it, vi } from 'vitest'
const post = vi.hoisted(() => vi.fn())
vi.mock('@/api/http', () => ({ apiHttpClient: { post } }))
import { requestFinishWithAvailable } from '../process-control'

describe('requestFinishWithAvailable', () => {
  beforeEach(() => { post.mockReset() })
  it('targets the active message through stop-tools, never whole-run cancel', async () => {
    post.mockResolvedValue({ data: { success: true, data: { accepted: true } } })
    await expect(requestFinishWithAvailable(7, { clientMessageId: 'client-1', messageId: 12 })).resolves.toEqual({ accepted: true })
    expect(post).toHaveBeenCalledWith('/chat/stream/stop-tools', { sessionId: 7, clientMessageId: 'client-1', messageId: 12 })
  })
  it('normalizes persisted numeric ids and omits temporary ids when a client key exists', async () => {
    post.mockResolvedValue({ data: { success: true, data: { accepted: true } } })
    await requestFinishWithAvailable(7, { messageId: '12' })
    expect(post).toHaveBeenLastCalledWith('/chat/stream/stop-tools', {sessionId:7,clientMessageId:undefined,messageId:12})
    await requestFinishWithAvailable(7, { messageId: 'temporary-id', clientMessageId:'client-1' })
    expect(post).toHaveBeenLastCalledWith('/chat/stream/stop-tools', {sessionId:7,clientMessageId:'client-1',messageId:undefined})
  })
  it('does not send a command without an exact message target', async () => {
    await expect(requestFinishWithAvailable(7, {})).rejects.toThrow('消息')
    expect(post).not.toHaveBeenCalled()
  })
  it('reports a rejected acknowledgement instead of presenting success', async () => {
    post.mockResolvedValue({ data: { success: true, data: { accepted: false, reason: 'already_finished' } } })
    await expect(requestFinishWithAvailable(7, { messageId: 12 })).rejects.toThrow()
  })
  it('shows server error details for an already released run', async () => {
    post.mockRejectedValue({ response: { data: { error: 'Stream not found' } } })
    await expect(requestFinishWithAvailable(7, { messageId: 12 })).rejects.toThrow('Stream not found')
  })
  it('propagates network failures without cancelling the local answer stream', async () => {
    post.mockRejectedValue(new Error('network failed'))
    await expect(requestFinishWithAvailable(7, { messageId: 12 })).rejects.toThrow('network failed')
  })
})
