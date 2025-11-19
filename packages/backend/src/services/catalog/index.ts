import { prisma } from '../../db'
import { BackendLogger as log } from '../../utils/logger'
import {
  refreshAllModelCatalog,
  refreshModelCatalogForConnections,
  refreshModelCatalogForConnectionId,
} from '../../utils/model-catalog'
import { computeCapabilities, deriveChannelName } from '../../utils/providers'
import { parseCapabilityEnvelope, normalizeCapabilityFlags, serializeCapabilityEnvelope } from '../../utils/capabilities'
import { invalidateCompletionLimitCache, invalidateContextWindowCache } from '../../utils/context-window'
import { ModelCatalogService } from './model-catalog-service'

export const modelCatalogService = new ModelCatalogService({
  prisma,
  refreshAllModelCatalog: refreshAllModelCatalog,
  refreshModelCatalogForConnections,
  refreshModelCatalogForConnectionId,
  computeCapabilities,
  deriveChannelName,
  parseCapabilityEnvelope,
  normalizeCapabilityFlags,
  serializeCapabilityEnvelope,
  invalidateCompletionLimitCache,
  invalidateContextWindowCache,
  logger: log,
})

export * from './model-catalog-service'
