type TitleSyncOptions = {
  initialBrandText?: string
  initialBrandFallback: boolean
  fetchBranding: () => Promise<boolean>
  bootstrapBrandText: (text?: string | null) => void
  now?: () => number
}

export const MAX_BRANDING_RETRIES = 3
export const BRANDING_RETRY_BASE_MS = 2000
export const BRANDING_RETRY_MAX_MS = 30000

export const brandingRetryDelay = (attempt: number) =>
  Math.min(BRANDING_RETRY_MAX_MS, BRANDING_RETRY_BASE_MS * Math.max(1, attempt))

/**
 * TitleSync 的模块级单例控制器：StrictMode 双挂载共享同一次请求，
 * 卸载后不再自行发起新请求；失败只做有限指数退避，成功即停止。
 */
export class BrandingRetryController {
  private inFlight: Promise<boolean> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private subscribers = 0
  private succeeded = false
  private activeOptions = {} as TitleSyncOptions

  constructor(options: TitleSyncOptions) {
    this.activeOptions = options
  }

  /** 身份切换或管理员改动后刷新，重置失败预算并立即拉取。 */
  refresh() {
    this.attempts = 0
    this.succeeded = false
    this.clearTimer()
    if (this.subscribers === 0) return
    void this.run()
  }

  start() {
    this.subscribers += 1
    if (this.subscribers > 1) return

    if (this.succeeded) return
    if (this.inFlight || this.timer) return

    const initial = (this.activeOptions.initialBrandText ?? '').trim()
    if (initial) {
      this.activeOptions.bootstrapBrandText(initial)
      if (!this.activeOptions.initialBrandFallback) {
        this.succeeded = true
        return
      }
    }

    void this.run()
  }

  updateOptions(options: TitleSyncOptions) {
    this.activeOptions = options
  }

  dispose() {
    this.subscribers = Math.max(0, this.subscribers - 1)
    if (this.subscribers === 0) {
      this.clearTimer()
      // 真正卸载后重置退避计数；StrictMode 的短暂卸载由重新 start 复用同一实例。
      this.attempts = 0
    }
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async run(): Promise<boolean> {
    if (this.subscribers === 0 || this.succeeded) return this.succeeded
    if (this.inFlight) return this.inFlight

    const request = this.activeOptions.fetchBranding().catch(() => false)
    this.inFlight = request
    const success = await request
    this.inFlight = null

    if (success) {
      this.succeeded = true
      this.attempts = 0
      this.clearTimer()
      return true
    }

    // 卸载期间（StrictMode 重挂载窗口）不排期；重新订阅时由 start 续跑。
    if (this.subscribers === 0) return false
    if (this.attempts >= MAX_BRANDING_RETRIES) return false
    const delay = brandingRetryDelay(this.attempts + 1)
    this.attempts += 1
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, delay)
    return false
  }
}

let sharedController: BrandingRetryController | null = null

export function getSharedBrandingController(options: TitleSyncOptions) {
  if (!sharedController) {
    sharedController = new BrandingRetryController(options)
  }
  return sharedController
}

export function resetSharedBrandingControllerForTests() {
  sharedController?.dispose()
  sharedController = null
}
