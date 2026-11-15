import { vi } from 'vitest'
import { useModelsStore, type ModelItem } from '@/store/models-store'

// Exercise the real store, Radix overlays, search and rows without a provider request.
export const longName = 'GPT-4.1 超长中文模型名称用于验证当前模型可读与操作区域独立布局'
export const primary: ModelItem = {
  id: 'gpt-ui', rawId: 'gpt-ui', name: longName, provider: 'openai',
  displayName: '工作连接甲', channelName: '工作连接甲', connectionBaseUrl: 'https://fixture.invalid',
  connectionId: 11, capabilities: { vision: true }, contextWindow: 128000,
}
export const duplicate: ModelItem = { ...primary, connectionId: 12, displayName: '工作连接乙', channelName: '工作连接乙' }
export const image: ModelItem = {
  ...primary, id: 'gpt-image', rawId: 'gpt-image', name: 'GPT Image', provider: 'anthropic', connectionId: 13,
  displayName: '绘图连接', channelName: '绘图连接', capabilities: { image_generation: true },
}
export const models = [primary, duplicate, image]
export const initialFetchAll = useModelsStore.getState().fetchAll

export function viewport(mobile: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: mobile && query === '(max-width: 767px)', media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(),
    removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
}

export function prepareSelectorTest() {
  localStorage.clear()
  viewport(false)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useModelsStore.setState({ models, isLoading: false, error: null, fetchAll: initialFetchAll })
}

// Specification copy: six values, with unset meaning "do not set explicitly".
export const efforts = ['unset', 'low', 'medium', 'high', 'max', 'xhigh'] as const
export type Effort = (typeof efforts)[number]
export const effortLabels: Record<Effort, string> = {
  unset: '默认', low: 'Low', medium: 'Medium', high: 'High', max: 'Max', xhigh: 'XHigh',
}
export const effortOption = (value: Effort) => new RegExp('^' + effortLabels[value])
