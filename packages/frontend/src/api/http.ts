/**
 * 前端统一 HTTP 客户端入口。
 *
 * 所有 feature API 模块统一从这里取 apiHttpClient / 401 处理，
 * 避免各自直接依赖 lib/api 实现细节。
 */
export { apiHttpClient, handleUnauthorizedRedirect } from '@/lib/api'
export { DEFAULT_API_BASE_URL } from '@/lib/http/client'
