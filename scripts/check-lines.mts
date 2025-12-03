#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

type Options = {
  root: string
  maxLines: number
  avgLimit?: number
  whitelist: RegExp[]
}

const parseArgs = (): Options => {
  const argv = process.argv.slice(2)
  const getValue = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    if (idx >= 0 && idx + 1 < argv.length) {
      return argv[idx + 1]
    }
    return undefined
  }
  const rootArg = getValue('--root') || 'packages/frontend/src'
  const maxArg = Number(getValue('--max') || 300)
  const avgArgRaw = getValue('--avg')
  const avgArg = avgArgRaw ? Number(avgArgRaw) : undefined
  if (!Number.isFinite(maxArg) || maxArg <= 0) {
    throw new Error('`--max` must be a positive number')
  }
  if (avgArg !== undefined && (!Number.isFinite(avgArg) || avgArg <= 0)) {
    throw new Error('`--avg` must be a positive number when provided')
  }
  const whitelistArg = getValue('--whitelist')
  const patterns = (whitelistArg || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    root: path.resolve(process.cwd(), rootArg),
    maxLines: maxArg,
    avgLimit: avgArg,
    whitelist: patterns.map((pattern) => globToRegex(pattern)),
  }
}

const globToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

const shouldSkipDir = (dirName: string) =>
  ['node_modules', '.next', 'dist', 'build', '.git'].includes(dirName)

const isTargetFile = (filePath: string) => {
  return (
    (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) &&
    !filePath.endsWith('.d.ts') &&
    !filePath.endsWith('.d.tsx')
  )
}

const collectFiles = (dir: string, root: string, acc: string[]) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  entries.forEach((entry) => {
    const nextPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        collectFiles(nextPath, root, acc)
      }
      return
    }
    if (entry.isFile()) {
      if (isTargetFile(entry.name)) {
        const rel = path.relative(root, nextPath)
        acc.push(rel)
      }
    }
  })
}

const countLines = (absPath: string) => {
  const content = fs.readFileSync(absPath, 'utf8')
  if (content.length === 0) {
    return 0
  }
  return content.split(/\r?\n/).length
}

const run = () => {
  const { root, maxLines, avgLimit, whitelist } = parseArgs()
  if (!fs.existsSync(root)) {
    console.error(`[lines] root path not found: ${root}`)
    process.exit(1)
  }
  const files: string[] = []
  collectFiles(root, root, files)
  const violations: { file: string; lines: number }[] = []
  let totalLines = 0
  let countedFiles = 0

  files.forEach((relPath) => {
    const normalized = relPath.split(path.sep).join('/')
    const isWhitelisted = whitelist.some((reg) => reg.test(normalized))
    const absPath = path.join(root, relPath)
    const lines = countLines(absPath)
    if (!isWhitelisted) {
      if (lines > maxLines) {
        violations.push({ file: normalized, lines })
      }
      totalLines += lines
      countedFiles += 1
    }
  })

  let avgViolation: number | null = null
  if (avgLimit && countedFiles > 0) {
    const avg = totalLines / countedFiles
    if (avg > avgLimit) {
      avgViolation = avg
    }
  }

  if (violations.length === 0 && avgViolation === null) {
    console.log(
      `[lines] OK - checked ${countedFiles} files, average ${(
        totalLines / Math.max(countedFiles, 1)
      ).toFixed(2)} lines`,
    )
    return
  }

  if (violations.length > 0) {
    console.error('[lines] Files exceeding line limit:')
    violations
      .sort((a, b) => b.lines - a.lines)
      .forEach((item) => {
        console.error(`  - ${item.file} (${item.lines} lines)`)
      })
  }
  if (avgViolation !== null) {
    console.error(
      `[lines] Average lines exceeded: ${avgViolation.toFixed(2)} > ${avgLimit}`,
    )
  }
  process.exit(1)
}

run()
