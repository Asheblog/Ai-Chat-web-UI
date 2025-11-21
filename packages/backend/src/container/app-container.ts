import type { AppContext } from '../context/app-context'
import { createAppContext } from '../context/app-context'
import {
  PrismaConnectionRepository,
  type ConnectionRepository,
} from '../repositories/connection-repository'
import {
  PrismaModelResolverRepository,
  type ModelResolverRepository,
} from '../repositories/model-resolver-repository'
import { ConnectionService } from '../services/connections'
import { ModelResolverService } from '../services/catalog/model-resolver-service'
import { AuthUtils } from '../utils/auth'
import { refreshModelCatalogForConnection } from '../utils/model-catalog'
import { verifyConnection } from '../utils/providers'
import { BackendLogger as log } from '../utils/logger'
import { setModelResolverService } from '../utils/model-resolver'
import { SessionService } from '../services/sessions/session-service'

export interface AppContainerDeps {
  context?: AppContext
  connectionRepository?: ConnectionRepository
  connectionService?: ConnectionService
  modelResolverRepository?: ModelResolverRepository
  modelResolverService?: ModelResolverService
  sessionService?: SessionService
}

export class AppContainer {
  readonly context: AppContext
  readonly connectionRepository: ConnectionRepository
  readonly connectionService: ConnectionService
  readonly modelResolverRepository: ModelResolverRepository
  readonly modelResolverService: ModelResolverService
  readonly sessionService: SessionService

  constructor(deps: AppContainerDeps = {}) {
    this.context = deps.context ?? createAppContext()
    this.connectionRepository =
      deps.connectionRepository ?? new PrismaConnectionRepository(this.context.prisma)
    this.modelResolverRepository =
      deps.modelResolverRepository ?? new PrismaModelResolverRepository(this.context.prisma)
    this.modelResolverService =
      deps.modelResolverService ??
      new ModelResolverService({
        repository: this.modelResolverRepository,
      })
    setModelResolverService(this.modelResolverService)
    this.connectionService =
      deps.connectionService ??
      new ConnectionService({
        repository: this.connectionRepository,
        encryptApiKey: AuthUtils.encryptApiKey,
        refreshModelCatalog: refreshModelCatalogForConnection,
        verifyConnection,
        logger: log,
      })
    this.sessionService =
      deps.sessionService ??
      new SessionService({
        prisma: this.context.prisma,
        modelResolverService: this.modelResolverService,
        logger: this.context.logger,
      })
  }
}

export const createAppContainer = (deps?: AppContainerDeps) => new AppContainer(deps)
