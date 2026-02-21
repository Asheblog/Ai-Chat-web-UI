import { prisma } from '../../db'
import { PythonRuntimeService } from './python-runtime-service'

export const pythonRuntimeService = new PythonRuntimeService({
  prisma,
  env: process.env,
  platform: process.platform,
})

export * from './python-runtime-service'
