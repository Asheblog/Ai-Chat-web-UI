/**
 * ServiceRegistry - 中央服务注册表
 *
 * 用于替代分散的全局 setter 函数，提供类型安全的服务注册和解析。
 */

export class ServiceRegistry {
  private static instance: ServiceRegistry | null = null
  private services = new Map<string, unknown>()
  private initialized = false

  private constructor() {}

  static getInstance(): ServiceRegistry {
    if (!this.instance) {
      this.instance = new ServiceRegistry()
    }
    return this.instance
  }

  /**
   * 注册服务实例
   */
  register<T>(key: string, service: T): void {
    if (this.services.has(key)) {
      // 允许覆盖，但记录警告（测试场景常见）
      console.debug(`ServiceRegistry: Overwriting existing service "${key}"`)
    }
    this.services.set(key, service)
  }

  /**
   * 解析服务实例
   * @throws Error 如果服务未注册
   */
  resolve<T>(key: string): T {
    const service = this.services.get(key)
    if (service === undefined) {
      throw new Error(
        `ServiceRegistry: Service "${key}" not registered. ` +
          `Ensure AppContainer is initialized before accessing services.`
      )
    }
    return service as T
  }

  /**
   * 尝试解析服务（不抛出异常）
   */
  tryResolve<T>(key: string): T | undefined {
    return this.services.get(key) as T | undefined
  }

  /**
   * 检查服务是否已注册
   */
  has(key: string): boolean {
    return this.services.has(key)
  }

  /**
   * 标记注册表已完成初始化
   */
  markInitialized(): void {
    this.initialized = true
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * 获取所有已注册的服务键
   */
  getRegisteredKeys(): string[] {
    return Array.from(this.services.keys())
  }

  /**
   * 重置注册表（仅用于测试）
   */
  static reset(): void {
    if (this.instance) {
      this.instance.services.clear()
      this.instance.initialized = false
    }
    this.instance = null
  }

  /**
   * 清除所有服务但保留实例（用于测试间重置）
   */
  clear(): void {
    this.services.clear()
    this.initialized = false
  }
}

// 便捷导出
export const getRegistry = () => ServiceRegistry.getInstance()
