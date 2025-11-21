import { prisma } from '../../db'
import { AuthUtils } from '../../utils/auth'
import { inspectActorQuota } from '../../utils/quota'
import { BackendLogger as log } from '../../utils/logger'
import { UserService } from './user-service'

let userService: UserService = new UserService({
  prisma,
  authUtils: AuthUtils,
  inspectActorQuota,
  logger: log,
})

export const setUserService = (service: UserService) => {
  userService = service
}

export { userService }

export * from './user-service'
