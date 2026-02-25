import { createLogger } from '../../utils/logger'
import { getAppConfig, type WorkspaceConfig } from '../../config/app-config'
import { ArtifactService, artifactService as defaultArtifactService } from './artifact-service'
import { WorkspaceService, workspaceService as defaultWorkspaceService } from './workspace-service'

const log = createLogger('WorkspaceCleanup')

export interface WorkspaceCleanupServiceDeps {
  config?: WorkspaceConfig
  workspaceService?: WorkspaceService
  artifactService?: ArtifactService
}

export class WorkspaceCleanupService {
  private readonly config: WorkspaceConfig
  private readonly workspaceService: WorkspaceService
  private readonly artifactService: ArtifactService
  private intervalId: NodeJS.Timeout | null = null
  private running = false

  constructor(deps: WorkspaceCleanupServiceDeps = {}) {
    this.config = deps.config ?? getAppConfig().workspace
    this.workspaceService = deps.workspaceService ?? defaultWorkspaceService
    this.artifactService = deps.artifactService ?? defaultArtifactService
  }

  start() {
    if (this.intervalId) return
    this.intervalId = setInterval(() => {
      void this.runOnce().catch((error) => {
        log.warn('workspace cleanup run failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, this.config.cleanupIntervalMs)

    void this.runOnce().catch((error) => {
      log.warn('workspace cleanup initial run failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  stop() {
    if (!this.intervalId) return
    clearInterval(this.intervalId)
    this.intervalId = null
  }

  async runOnce(): Promise<{
    expiredArtifacts: number
    expiredWorkspaces: number
    orphanWorkspaces: number
  }> {
    if (this.running) {
      return {
        expiredArtifacts: 0,
        expiredWorkspaces: 0,
        orphanWorkspaces: 0,
      }
    }
    this.running = true

    try {
      const [expiredArtifacts, expiredWorkspaces, orphanWorkspaces] = await Promise.all([
        this.artifactService.cleanupExpiredArtifacts(),
        this.workspaceService.cleanupExpiredWorkspaces(),
        this.workspaceService.cleanupOrphanWorkspaces(),
      ])

      if (expiredArtifacts > 0 || expiredWorkspaces > 0 || orphanWorkspaces > 0) {
        log.info('workspace cleanup finished', {
          expiredArtifacts,
          expiredWorkspaces,
          orphanWorkspaces,
        })
      }

      return {
        expiredArtifacts,
        expiredWorkspaces,
        orphanWorkspaces,
      }
    } finally {
      this.running = false
    }
  }
}

let workspaceCleanupService = new WorkspaceCleanupService()

export const setWorkspaceCleanupService = (service: WorkspaceCleanupService) => {
  workspaceCleanupService = service
}

export { workspaceCleanupService }
