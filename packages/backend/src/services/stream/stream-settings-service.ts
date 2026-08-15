import type { PrismaClient } from '@prisma/client'

export const STREAM_KEEPALIVE_SETTING_KEY = 'stream_keepalive_interval_ms'

export interface StreamSettingsServiceDeps {
  prisma: Pick<PrismaClient, 'systemSetting'>
}

export class StreamSettingsService {
  constructor(private readonly deps: StreamSettingsServiceDeps) {}

  async resolveKeepaliveIntervalMs(): Promise<number> {
    let raw = process.env.STREAM_KEEPALIVE_INTERVAL_MS || '0'
    try {
      const record = await this.deps.prisma.systemSetting.findUnique({
        where: { key: STREAM_KEEPALIVE_SETTING_KEY },
        select: { value: true },
      })
      if (record?.value != null && String(record.value).trim() !== '') {
        raw = String(record.value)
      }
    } catch {
      // Stream keepalive is best-effort; falling back to env/default is safe.
    }
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
    return 0
  }
}
