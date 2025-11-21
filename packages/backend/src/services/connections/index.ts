import { ConnectionService } from './connection-service'
import { prisma } from '../../db'
import { AuthUtils } from '../../utils/auth'
import { refreshModelCatalogForConnection } from '../../utils/model-catalog'
import { verifyConnection } from '../../utils/providers'
import { BackendLogger as log } from '../../utils/logger'
import { PrismaConnectionRepository } from '../../repositories/connection-repository'

const connectionRepository = new PrismaConnectionRepository(prisma)

let connectionService: ConnectionService = new ConnectionService({
  repository: connectionRepository,
  encryptApiKey: AuthUtils.encryptApiKey,
  refreshModelCatalog: refreshModelCatalogForConnection,
  verifyConnection,
  logger: log,
})

export const setConnectionService = (service: ConnectionService) => {
  connectionService = service
}

export { connectionService }

export * from './connection-service'
