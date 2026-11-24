import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readServer, saveServer } from '../src/preferences.mjs'

test('persists and replaces the last successful server in a new profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'aichat-preferences-'))
  try {
    const file = join(profile, 'server.json')
    assert.equal(await readServer(file), null)
    const first = { origin: 'https://chat.example.test', insecure: false }
    await saveServer(file, first)
    assert.deepEqual(await readServer(file), { ok: true, ...first })
    const replacement = { origin: 'http://192.168.1.20:3000', insecure: true }
    await saveServer(file, replacement)
    assert.deepEqual(await readServer(file), { ok: true, ...replacement })
  } finally {
    await rm(profile, { recursive: true })
  }
})
