import type {
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
import { FrontendLogger as log } from '@/lib/logger'

type MetadataConfig = InternalAxiosRequestConfig & {
  metadata?: { start: number }
}

export interface InterceptorHooks {
  onUnauthorized?: () => void
}

export const applyDefaultInterceptors = (
  instance: AxiosInstance,
  hooks?: InterceptorHooks,
) => {
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const withMeta = config as MetadataConfig
      withMeta.metadata = { start: Date.now() }
      try {
        log.debug(
          'HTTP Request',
          config.method?.toUpperCase(),
          `${config.baseURL || ''}${config.url || ''}`,
          {
            headers: config.headers,
            params: config.params,
          },
        )
      } catch {
        // ignore logging failures
      }
      return config
    },
    (error) => Promise.reject(error),
  )

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      try {
        const meta = (response.config as MetadataConfig).metadata
        const start = meta?.start || Date.now()
        log.debug(
          'HTTP Response',
          response.status,
          response.statusText,
          'in',
          `${Date.now() - start}ms`,
          {
            url: `${response.config.baseURL || ''}${response.config.url || ''}`,
          },
        )
      } catch {
        // ignore logging failures
      }
      return response
    },
    (error) => {
      try {
        const cfg = (error?.config || {}) as MetadataConfig
        const start = cfg.metadata?.start || Date.now()
        log.error(
          'HTTP Error',
          error?.message,
          'in',
          `${Date.now() - start}ms`,
          {
            url: `${cfg.baseURL || ''}${cfg.url || ''}`,
            status: error?.response?.status,
            data: error?.response?.data,
          },
        )
      } catch {
        // ignore logging failures
      }
      if (error?.response?.status === 401) {
        hooks?.onUnauthorized?.()
      }
      return Promise.reject(error)
    },
  )
}
