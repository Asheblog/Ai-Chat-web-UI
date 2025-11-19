import { prisma } from '../../db'
import { AuthUtils } from '../../utils/auth'
import { inspectActorQuota } from '../../utils/quota'
import { BackendLogger as log } from '../../utils/logger'
import { UserService } from './user-service'

export const userService = new UserService({
  prisma,
  authUtils: AuthUtils,
  inspectActorQuota,
  logger: log,
})

export * from './user-service'
