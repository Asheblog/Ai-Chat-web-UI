jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    const role = (c.req.header('x-role') || 'ADMIN').toUpperCase()
    c.set('actor', { type: 'user', id: 1, role, status: 'ACTIVE', username: 'tester', identifier: 'user:1' })
    c.set('user', { id: 1, username: 'tester', role, status: 'ACTIVE' })
    await next()
  },
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (c: any, next: any) => {
    const actor = c.get('actor')
    if (!actor || actor.role !== 'ADMIN') {
      return c.json({ success: false, error: 'Admin required' }, 403)
    }
    await next()
  },
}))

import { createSettingsApi } from '../settings'
import type { SettingsFacade } from '../../services/settings/settings-facade'
import type { PythonRuntimeService } from '../../services/python-runtime'
import type { VisionProxyService } from '../../modules/chat/services/vision-proxy-service'
import type {
  ImageTranscriptionProbeService,
  ProbeResult,
} from '../../services/settings/image-transcription-probe-service'

const probeResult: ProbeResult = {
  ok: false,
  steps: [{ name: 'transcribe', ok: false, durationMs: 12, error: '转写模型请求失败（HTTP 502）' }],
}

describe('settings image transcription probe api', () => {
  it('returns structured probe failures with HTTP 200 to an administrator', async () => {
    const probe = { probe: jest.fn().mockResolvedValue(probeResult) }
    const app = createSettingsApi({
      settingsFacade: {} as SettingsFacade,
      pythonRuntimeService: {} as PythonRuntimeService,
      visionProxyService: {} as VisionProxyService,
      imageTranscriptionProbeService: probe as Pick<ImageTranscriptionProbeService, 'probe'>,
    })

    const res = await app.request('http://localhost/image-transcription/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'ADMIN' },
      body: JSON.stringify({ imageBase64: 'dGVzdA==', mime: 'image/png' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true, data: probeResult })
    expect(probe.probe).toHaveBeenCalledWith({ imageBase64: 'dGVzdA==', mime: 'image/png' })
  })

  it('rejects non-administrators before starting the probe', async () => {
    const probe = { probe: jest.fn() }
    const app = createSettingsApi({
      settingsFacade: {} as SettingsFacade,
      pythonRuntimeService: {} as PythonRuntimeService,
      visionProxyService: {} as VisionProxyService,
      imageTranscriptionProbeService: probe as Pick<ImageTranscriptionProbeService, 'probe'>,
    })

    const res = await app.request('http://localhost/image-transcription/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-role': 'USER' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(403)
    expect(probe.probe).not.toHaveBeenCalled()
  })
})
