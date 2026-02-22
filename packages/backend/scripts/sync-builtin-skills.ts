#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'
import { syncBuiltinSkills } from '../src/modules/skills/builtin-skills'

const prisma = new PrismaClient()

async function main() {
  await prisma.$connect()
  await syncBuiltinSkills(prisma)
  console.log('✅ Builtin skills synced')
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`❌ Builtin skills sync failed: ${message}`)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
