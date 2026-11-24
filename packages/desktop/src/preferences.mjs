import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseServerAddress } from './connection.mjs'

export async function readServer(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'))
    const parsed = parseServerAddress(value?.origin)
    if (parsed.ok && (!parsed.insecure || value.allowInsecure === true)) return parsed
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read server address:', error.message)
  }
  return null
}

export async function saveServer(file, { origin, insecure }) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = file + '.tmp'
  await writeFile(temporary, JSON.stringify({ origin, allowInsecure: insecure }) + '\n', 'utf8')
  await rename(temporary, file)
}
