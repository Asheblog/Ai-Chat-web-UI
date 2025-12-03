import axios, { type AxiosInstance } from 'axios'
import { applyDefaultInterceptors, type InterceptorHooks } from './interceptors'

export const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api'

export interface HttpClientOptions {
  baseURL?: string
  timeout?: number
  headers?: Record<string, string>
  withCredentials?: boolean
}

export function createHttpClient(
  options: HttpClientOptions = {},
  hooks?: InterceptorHooks,
): AxiosInstance {
  const {
    baseURL = DEFAULT_API_BASE_URL,
    timeout = 30000,
    headers = { 'Content-Type': 'application/json' },
    withCredentials = true,
  } = options

  const client = axios.create({
    baseURL,
    timeout,
    headers,
    withCredentials,
  })

  applyDefaultInterceptors(client, hooks)

  return client
}
