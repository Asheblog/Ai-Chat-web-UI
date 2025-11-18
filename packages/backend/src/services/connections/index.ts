import { ConnectionService } from './connection-service'
import { prisma } from '../../db'
import { AuthUtils } from '../../utils/auth'
import { refreshModelCatalogForConnection } from '../../utils/model-catalog'
import { verifyConnection } from '../../utils/providers'
import { BackendLogger as log } from '../../utils/logger'

export const connectionService = new ConnectionService({
  prisma,
  encryptApiKey: AuthUtils.encryptApiKey,
  refreshModelCatalog: refreshModelCatalogForConnection,
  verifyConnection,
  logger: log,
})

export * from './connection-service'
