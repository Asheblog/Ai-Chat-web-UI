import type { ProviderRequester } from '../../services/provider-requester'
import type { NonStreamFallbackService } from '../../services/non-stream-fallback-service'

export class ProviderStreamEngine {
  constructor(
    private readonly deps: {
      providerRequester: ProviderRequester
      nonStreamFallbackService: NonStreamFallbackService
    },
  ) {}

  requestWithBackoff(params: Parameters<ProviderRequester['requestWithBackoff']>[0]) {
    return this.deps.providerRequester.requestWithBackoff(params)
  }

  executeFallback(params: Parameters<NonStreamFallbackService['execute']>[0]) {
    return this.deps.nonStreamFallbackService.execute(params)
  }
}
