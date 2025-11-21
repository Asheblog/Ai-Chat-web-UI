import type { AppContext } from '../context/app-context'
import { createAppContext } from '../context/app-context'
import {
  PrismaConnectionRepository,
  type ConnectionRepository,
} from '../repositories/connection-repository'
import { ConnectionService } from '../services/connections'
import { AuthUtils } from '../utils/auth'
import { refreshModelCatalogForConnection } from '../utils/model-catalog'
import { verifyConnection } from '../utils/providers'
import { BackendLogger as log } from '../utils/logger'

export interface AppContainerDeps {
  context?: AppContext
  connectionRepository?: ConnectionRepository
  connectionService?: ConnectionService
}

export class AppContainer {
  readonly context: AppContext
  readonly connectionRepository: ConnectionRepository
  readonly connectionService: ConnectionService

  constructor(deps: AppContainerDeps = {}) {
    this.context = deps.context ?? createAppContext()
    this.connectionRepository =
      deps.connectionRepository ?? new PrismaConnectionRepository(this.context.prisma)
    this.connectionService =
      deps.connectionService ??
      new ConnectionService({
        repository: this.connectionRepository,
        encryptApiKey: AuthUtils.encryptApiKey,
        refreshModelCatalog: refreshModelCatalogForConnection,
        verifyConnection,
        logger: log,
      })
  }
}

export const createAppContainer = (deps?: AppContainerDeps) => new AppContainer(deps)
