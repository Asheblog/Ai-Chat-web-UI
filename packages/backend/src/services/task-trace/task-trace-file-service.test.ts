import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { taskTraceFileService } from './task-trace-file-service'

const createTempFile = async (lines: string[]) => {
  const dir = await mkdtemp(join(tmpdir(), 'ttfs-'))
  const file = join(dir, 'trace.ndjson')
  await writeFile(file, lines.join('\n'), 'utf8')
  return { dir, file }
}

describe('TaskTraceFileService', () => {
  it('reads trace events and respects limit', async () => {
    const { dir, file } = await createTempFile([
      JSON.stringify({ seq: 1, eventType: 'a', payload: { k: 1 }, timestamp: 't1' }),
      JSON.stringify({ seq: 2, eventType: 'b', payload: { k: 2 }, timestamp: 't2' }),
      JSON.stringify({ seq: 3, eventType: 'c', payload: { k: 3 }, timestamp: 't3' }),
    ])
    const { events, truncated } = await taskTraceFileService.readTraceEventsFromFile(file, 2)
    expect(truncated).toBe(true)
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(
      expect.objectContaining({ seq: 1, eventType: 'a', payload: { k: 1 }, timestamp: 't1' }),
    )
    await rm(dir, { recursive: true, force: true })
  })

  it('reads latex events and handles missing file', async () => {
    const missing = await taskTraceFileService.readLatexEventsFromFile('/path/nonexistent.ndjson', 2)
    expect(missing.events).toHaveLength(0)
    expect(missing.truncated).toBe(false)

    const { dir, file } = await createTempFile([
      JSON.stringify({ seq: 1, matched: true, reason: 'ok', raw: 'r', normalized: 'n', trimmed: 't' }),
      'invalid',
    ])
    const { events, truncated } = await taskTraceFileService.readLatexEventsFromFile(file, 5)
    expect(truncated).toBe(false)
    expect(events[0]).toEqual(
      expect.objectContaining({ seq: 1, matched: true, reason: 'ok', raw: 'r' }),
    )
    await rm(dir, { recursive: true, force: true })
  })
})
