import { ConnectionService } from './connection-service'
import { prisma } from '../../db'
import { SecretVaultService } from '../secret-vault'
import { refreshModelCatalogForConnection } from '../../utils/model-catalog'
import { verifyConnection } from '../../utils/providers'
import { BackendLogger as log } from '../../utils/logger'
import { PrismaConnectionRepository } from '../../repositories/connection-repository'

const connectionRepository = new PrismaConnectionRepository(prisma)

let secretVault: SecretVaultService
try {
  secretVault = new SecretVaultService()
} catch (error) {
  log.error('Secret Vault 初始化失败，服务器将无法启动。请设置 SECRET_VAULT_MASTER_KEY 环境变量。', error)
  throw error
}

let connectionService: ConnectionService = new ConnectionService({
  repository: connectionRepository,
  secretVault,
  refreshModelCatalog: refreshModelCatalogForConnection,
  verifyConnection,
  logger: log,
})

export const setConnectionService = (service: ConnectionService) => {
  connectionService = service
}

export { connectionService }

export * from './connection-service'
