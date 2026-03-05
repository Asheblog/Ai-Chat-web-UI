import type { AssistantProgressService } from '../../services/assistant-progress-service'
import type { StreamUsageService } from '../../services/stream-usage-service'

export class StreamPersistenceSink {
  constructor(
    private readonly deps: {
      assistantProgressService: AssistantProgressService
      streamUsageService: StreamUsageService
    },
  ) {}

  persistProgress(params: Parameters<AssistantProgressService['persistProgress']>[0]) {
    return this.deps.assistantProgressService.persistProgress(params)
  }

  finalizeUsage(params: Parameters<StreamUsageService['finalize']>[0]) {
    return this.deps.streamUsageService.finalize(params)
  }
}
