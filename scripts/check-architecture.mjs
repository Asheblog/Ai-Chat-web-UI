import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const ROOTS = [
  'packages/backend/src',
  'packages/frontend/src',
  'packages/mobile/src',
  'packages/shared/src',
]

const stripComments = (text) => text
  .replace(/\/\/.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function collectFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
    }
  }
  walk(root)
  return out
}

const posix = (p) => p.split(path.sep).join('/')

function resolveImport(spec, fromFile, rootRel, fileSet) {
  const candidates = []
  if (spec.startsWith('@/')) {
    const target = posix(path.join(ROOT, rootRel.replace(/^packages\/([^/]+)\/src/, 'packages/$1/src'), spec.slice(2)))
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) candidates.push(target + ext)
  } else if (spec.startsWith('.')) {
    const base = posix(path.join(ROOT, posix(fromFile).replace(/^packages\/([^/]+)\/src/, 'packages/$1/src')))
    // Recompute from filesystem path instead to avoid duplicated roots.
    const basePath = path.resolve(path.dirname(fromFile), spec)
    const q = posix(basePath)
    for (const ext of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) candidates.push(q + ext)
  }
  return candidates.find((c) => fileSet.has(c))
}

const failures = []
const allFileSets = new Map()
for (const rootRel of ROOTS) {
  const root = path.join(ROOT, rootRel)
  if (!fs.existsSync(root)) continue
  const files = collectFiles(root)
  allFileSets.set(rootRel, new Set(files.map(posix)))
}

for (const rootRel of ROOTS) {
  const root = path.join(ROOT, rootRel)
  if (!fs.existsSync(root)) continue
  const files = collectFiles(root).map(posix)
  const fileSet = allFileSets.get(rootRel)
  const edges = new Map(files.map((f) => [f, []]))

  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'))
    const deps = edges.get(file)
    const re = /from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g
    let match
    while ((match = re.exec(text))) {
      const spec = match[1] || match[2]
      const target = resolveImport(spec, file, rootRel, fileSet)
      if (target) deps.push(target)
    }

    // HTTP/API layer must not reach into the Prisma singleton.
    if (rootRel === 'packages/backend/src' && file.includes('/api/') && /from\s+['"]\.\.?\/.*\bdb['"]/.test(text)) {
      failures.push(`${file}: api layer must not import the db singleton; use an injected service/repository`)
    }

    // Service layer must not reach into the chat module; shared kernels live in agent-runtime / services.
    if (
      rootRel === 'packages/backend/src' &&
      file.includes('/services/') &&
      !file.endsWith('.test.ts') &&
      /from\s+['"]\.\.?\/.*modules\/chat\//.test(text)
    ) {
      failures.push(`${file}: services layer must not import modules/chat; use agent-runtime or services/*`)
    }

    // Utils layer must not reach into feature modules.
    if (
      rootRel === 'packages/backend/src' &&
      file.includes('/utils/') &&
      !file.endsWith('.test.ts') &&
      /from\s+['"]\.\.?\/.*modules\//.test(text)
    ) {
      failures.push(`${file}: utils layer must not import modules/*; keep utils pure or move the dependency to services`)
    }
  }

  const index = new Map()
  const low = new Map()
  const stack = []
  const onStack = new Set()
  let cursor = 0
  const sccs = []
  const strongconnect = (v) => {
    index.set(v, cursor)
    low.set(v, cursor)
    cursor += 1
    stack.push(v)
    onStack.add(v)
    for (const w of edges.get(v) || []) {
      if (!index.has(w)) {
        strongconnect(w)
        low.set(v, Math.min(low.get(v), low.get(w)))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)))
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc = []
      let w
      do {
        w = stack.pop()
        onStack.delete(w)
        scc.push(w)
      } while (w !== v)
      sccs.push(scc)
    }
  }
  for (const file of files) if (!index.has(file)) strongconnect(file)

  for (const scc of sccs) {
    if (scc.length > 1 || (scc.length === 1 && edges.get(scc[0]).includes(scc[0]))) {
      failures.push(`${rootRel}: circular imports detected -> ${scc.join(' -> ')}`)
    }
  }
}

// Every declared backend service key must be registered by the container, with
// the exception of lazily/dynamically managed singletons (stream meta store and
// RAG document services).
const keysPath = path.join(ROOT, 'packages/backend/src/container/service-keys.ts')
const containerPath = path.join(ROOT, 'packages/backend/src/container/app-container.ts')
if (fs.existsSync(keysPath) && fs.existsSync(containerPath)) {
  const keySource = fs.readFileSync(keysPath, 'utf8')
  const containerSource = fs.readFileSync(containerPath, 'utf8')
  const declaredKeys = [...keySource.matchAll(/^\s{2}(\w+):\s*'([^']+)'/gm)].map((m) => m[1])
  const registeredKeys = new Set(
    [...containerSource.matchAll(/registry\.register\(SERVICE_KEYS\.(\w+)/g)].map((m) => m[1]),
  )
  const lazyKeys = new Set(['streamMetaStore', 'documentServices'])
  for (const key of declaredKeys) {
    if (!registeredKeys.has(key) && !lazyKeys.has(key)) {
      failures.push(`container/service-keys.ts: ${key} is declared but never registered in AppContainer`)
    }
  }
}

if (failures.length > 0) {
  console.error('[architecture] violations detected:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`[architecture] OK: ${allFileSets.size} package sources, no cycles, api layer db-free`)
