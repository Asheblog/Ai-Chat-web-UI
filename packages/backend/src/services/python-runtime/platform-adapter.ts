import path from 'node:path'

export interface RuntimePaths {
  dataRoot: string
  runtimeRoot: string
  venvPath: string
  pythonPath: string
}

export class PythonRuntimePlatformAdapter {
  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly platform: NodeJS.Platform,
  ) {}

  resolvePaths(): RuntimePaths {
    const rawDataRoot = this.env.APP_DATA_DIR || this.env.DATA_DIR || path.resolve(process.cwd(), 'data')
    const dataRoot = path.resolve(rawDataRoot)
    const runtimeRoot = path.resolve(dataRoot, 'python-runtime')
    const venvPath = path.resolve(runtimeRoot, 'venv')
    const pythonPath =
      this.platform === 'win32'
        ? path.resolve(venvPath, 'Scripts', 'python.exe')
        : path.resolve(venvPath, 'bin', 'python')

    return {
      dataRoot,
      runtimeRoot,
      venvPath,
      pythonPath,
    }
  }
}
