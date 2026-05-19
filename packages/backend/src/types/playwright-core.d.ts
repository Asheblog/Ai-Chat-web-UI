declare module 'playwright-core' {
  export const chromium: {
    launch(options: {
      executablePath?: string
      headless?: boolean
      args?: string[]
    }): Promise<{
      newContext(options?: {
        userAgent?: string
        locale?: string
        viewport?: { width: number; height: number }
        ignoreHTTPSErrors?: boolean
      }): Promise<{
        newPage(): Promise<{
          route(pattern: string, handler: (route: {
            request(): { resourceType(): string }
            abort(): Promise<void>
            continue(): Promise<void>
          }) => Promise<void>): Promise<void>
          goto(url: string, options?: { waitUntil?: 'domcontentloaded' | 'load' | 'networkidle'; timeout?: number }): Promise<unknown>
          waitForLoadState(state: 'domcontentloaded' | 'load' | 'networkidle', options?: { timeout?: number }): Promise<void>
          waitForTimeout(ms: number): Promise<void>
          evaluate(pageFunction: string): Promise<unknown>
          content(): Promise<string>
          url(): string
          title(): Promise<string>
        }>
        close(): Promise<void>
      }>
      close(): Promise<void>
    }>
  }
}
