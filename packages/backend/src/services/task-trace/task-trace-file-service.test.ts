import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { TaskTraceFileService } from './task-trace-file-service'

const createTempDir = async () => mkdtemp(join(tmpdir(), 'ttfs-'))

const createTempFile = async (lines: string[]) => {
  const dir = await createTempDir()
  const file = join(dir, 'trace-9.log')
  await writeFile(file, lines.join('\n'), 'utf8')
  return { dir, file }
}

const eventLine = (seq: number, eventType: string) =>
  JSON.stringify({ seq, eventType, payload: { seq }, timestamp: 't' })

describe('TaskTraceFileService', () => {
  const taskTraceFileService = new TaskTraceFileService()

  it('reads trace events and respects the display limit', async () => {
    const { dir, file } = await createTempFile([
      eventLine(1, 'a'),
      eventLine(2, 'b'),
      eventLine(3, 'c'),
    ])
    const result = await taskTraceFileService.readTraceEventsFromFile(file, 2, {
      traceId: 9,
      baseDir: dir,
      legacyDirs: [],
    })

    expect(result.status).toBe('ok')
    expect(result.truncated).toBe(true)
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toEqual(
      expect.objectContaining({ seq: 1, eventType: 'a', payload: { seq: 1 }, timestamp: 't' }),
    )
    expect(result.corruptLines).toBe(0)
    await rm(dir, { recursive: true, force: true })
  })

  it('reports a missing event file instead of pretending the trace has no events', async () => {
    const dir = await createTempDir()
    const result = await taskTraceFileService.readTraceEventsFromFile(join(dir, 'trace-9.log'), 2000, {
      traceId: 9,
      baseDir: dir,
      legacyDirs: [],
    })

    expect(result.status).toBe('missing')
    expect(result.resolution).toBe('missing')
    expect(result.resolvedPath).toBeNull()
    expect(result.events).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('reports an empty stored path distinctly from a missing file', async () => {
    const dir = await createTempDir()
    const result = await taskTraceFileService.readTraceEventsFromFile(null, 2000, {
      traceId: 9,
      baseDir: dir,
      legacyDirs: [],
    })

    expect(result.status).toBe('missing')
    expect(result.resolution).toBe('empty')
    await rm(dir, { recursive: true, force: true })
  })

  it('reports an unreadable path when the record points at a directory', async () => {
    const dir = await createTempDir()
    const traceDir = join(dir, 'trace-9.log')
    await mkdir(traceDir)
    const result = await taskTraceFileService.readTraceEventsFromFile(traceDir, 2000, {
      traceId: 9,
      baseDir: dir,
      legacyDirs: [],
    })

    expect(result.status).toBe('unreadable')
    expect(result.resolvedPath).toBe(traceDir)
    expect(result.error).toBeTruthy()
    await rm(dir, { recursive: true, force: true })
  })

  it('marks a file with unparseable lines as partial and counts them', async () => {
    const { dir, file } = await createTempFile([
      eventLine(1, 'a'),
      '{not json',
      eventLine(2, 'b'),
      'null-ish',
    ])
    const result = await taskTraceFileService.readTraceEventsFromFile(file, 2000, {
      traceId: 9,
      baseDir: dir,
      legacyDirs: [],
    })

    expect(result.status).toBe('partial')
    expect(result.corruptLines).toBe(2)
    expect(result.events.map((event) => event.eventType)).toEqual(['a', 'b'])
    await rm(dir, { recursive: true, force: true })
  })

  it('marks a file with no parseable event as corrupt', async () => {
    const { dir, file } = await createTempFile(['garbage', 'more garbage'])
    const result = await taskTraceFileService.readTraceEventsFromFile(file, 2000, {
      traceId: 9,
      baseDir: dir,
      legacyDirs: [],
    })

    expect(result.status).toBe('corrupt')
    expect(result.events).toEqual([])
    expect(result.corruptLines).toBe(2)
    await rm(dir, { recursive: true, force: true })
  })

  it('resolves a known legacy app directory to the current trace file', async () => {
    const dir = await createTempDir()
    const baseDir = join(dir, 'logs', 'task-trace')
    const legacyRoot = join(dir, 'packages', 'backend', 'logs', 'task-trace')
    await mkdir(baseDir, { recursive: true })
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(join(baseDir, 'trace-9.log'), [eventLine(1, 'a')].join('\n'), 'utf8')

    const result = await taskTraceFileService.readTraceEventsFromFile(
      join(legacyRoot, 'trace-9.log'),
      2000,
      { traceId: 9, baseDir, legacyDirs: [legacyRoot] },
    )

    expect(result.status).toBe('ok')
    expect(result.resolution).toBe('legacy-remap')
    expect(result.resolvedPath).toBe(resolve(baseDir, 'trace-9.log'))
    expect(result.events).toHaveLength(1)
    await rm(dir, { recursive: true, force: true })
  })

  it('remaps a legacy latex event file to the current latex directory', async () => {
    const dir = await createTempDir()
    const baseDir = join(dir, 'logs', 'latex-trace')
    const legacyRoot = join(dir, 'packages', 'backend', 'logs', 'latex-trace')
    await mkdir(baseDir, { recursive: true })
    await mkdir(legacyRoot, { recursive: true })
    const fileName = 'latex-trace-3-1700000000000.log'
    await writeFile(
      join(baseDir, fileName),
      [JSON.stringify({ seq: 1, matched: true, reason: 'ok', raw: 'r', normalized: 'n', trimmed: 't' })].join('\n'),
      'utf8',
    )

    const result = await taskTraceFileService.readLatexEventsFromFile(join(legacyRoot, fileName), 2000, {
      baseDir,
      legacyDirs: [legacyRoot],
    })

    expect(result.status).toBe('ok')
    expect(result.resolution).toBe('legacy-remap')
    expect(result.resolvedPath).toBe(join(baseDir, fileName))
    expect(result.events).toHaveLength(1)
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses a stored latex path outside known latex directories', async () => {
    const dir = await createTempDir()
    const baseDir = join(dir, 'logs', 'latex-trace')
    const result = await taskTraceFileService.readLatexEventsFromFile(join(dir, 'elsewhere', 'latex-trace-3.log'), 2000, {
      baseDir,
      legacyDirs: [],
    })

    expect(result.status).toBe('missing')
    expect(result.resolution).toBe('legacy-root-unknown')
    await rm(dir, { recursive: true, force: true })
  })

  it('reports missing latex event files with an explicit status', async () => {
    const dir = await createTempDir()
    const result = await taskTraceFileService.readLatexEventsFromFile(join(dir, 'latex-trace-1-1.log'), 2000)

    expect(result.status).toBe('missing')
    expect(result.events).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('reads latex events and skips unparseable lines with a partial status', async () => {
    const dir = await createTempDir()
    const file = join(dir, 'latex-trace-1-1.log')
    await writeFile(
      file,
      [
        JSON.stringify({ seq: 1, matched: true, reason: 'ok', raw: 'r', normalized: 'n', trimmed: 't' }),
        'invalid',
      ].join('\n'),
      'utf8',
    )

    const result = await taskTraceFileService.readLatexEventsFromFile(file, 5, { baseDir: dir, legacyDirs: [] })
    expect(result.status).toBe('partial')
    expect(result.corruptLines).toBe(1)
    expect(result.events[0]).toEqual(
      expect.objectContaining({ seq: 1, matched: true, reason: 'ok', raw: 'r' }),
    )
    await rm(dir, { recursive: true, force: true })
  })
})