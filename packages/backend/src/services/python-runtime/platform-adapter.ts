import path from 'node:path'

export interface RuntimePaths {
  dataRoot: string
  runtimeRoot: string
  venvPath: string
  pythonPath: string
}

export class PythonRuntimePlatformAdapter {
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly pathImpl: path.PlatformPath

  constructor(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
    this.env = env
    this.platform = platform
    // 路径解析跟随目标运行平台而非宿主（Linux 容器 POSIX / Windows 宿主 win32），
    // 保证 Windows 宿主上运行测试/模拟时仍按目标平台生成路径
    this.pathImpl = platform === 'win32' ? path.win32 : path.posix
  }

  resolvePaths(): RuntimePaths {
    const rawDataRoot =
      this.env.APP_DATA_DIR || this.env.DATA_DIR || this.pathImpl.resolve(process.cwd(), 'data')
    const dataRoot = this.pathImpl.resolve(rawDataRoot)
    const runtimeRoot = this.pathImpl.resolve(dataRoot, 'python-runtime')
    const venvPath = this.pathImpl.resolve(runtimeRoot, 'venv')
    const pythonPath =
      this.platform === 'win32'
        ? this.pathImpl.resolve(venvPath, 'Scripts', 'python.exe')
        : this.pathImpl.resolve(venvPath, 'bin', 'python')

    return {
      dataRoot,
      runtimeRoot,
      venvPath,
      pythonPath,
    }
  }
}
