#!/usr/bin/env tsx

import { pythonRuntimeService } from '../src/services/python-runtime'

async function main() {
  const result = await pythonRuntimeService.reconcile()
  console.log(
    `✅ Python runtime reconcile completed: requirements=${result.requirements.length}, installed=${result.installedPackages.length}, pipCheck=${result.pipCheckPassed ? 'ok' : 'failed'}`,
  )
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`❌ Python runtime reconcile failed: ${message}`)
  process.exit(1)
})
