import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from '@/components/model-selector'
import { modelKeyFor } from '@/store/model-preference-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'

// Use the real store, Radix overlay, search controls and model rows. No provider API runs.
const longName = 'GPT-4.1 超长中文模型名称用于验证当前模型可读与操作区域独立布局'
const primary: ModelItem = {
  id: 'gpt-ui', rawId: 'gpt-ui', name: longName, provider: 'openai',
  displayName: '工作连接甲', channelName: '工作连接甲', connectionBaseUrl: 'https://fixture.invalid',
  connectionId: 11, capabilities: { vision: true }, contextWindow: 128000,
}
const duplicate: ModelItem = { ...primary, connectionId: 12, displayName: '工作连接乙', channelName: '工作连接乙' }
const image: ModelItem = {
  ...primary, id: 'gpt-image', rawId: 'gpt-image', name: 'GPT Image', connectionId: 13,
  displayName: '绘图连接', channelName: '绘图连接', capabilities: { image_generation: true },
}
const models = [primary, duplicate, image]
const initialFetchAll = useModelsStore.getState().fetchAll

function viewport(mobile: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: mobile && query === '(max-width: 767px)', media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(),
    removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
}

async function openSelector(props: Partial<React.ComponentProps<typeof ModelSelector>> = {}) {
  const onModelChange = vi.fn()
  const user = userEvent.setup()
  render(<ModelSelector selectedModelId={modelKeyFor(primary)} onModelChange={onModelChange} {...props} />)
  await user.click(screen.getByRole('combobox', { name: '选择模型' }))
  const search = await screen.findByPlaceholderText('搜索模型 / 厂商 / 能力')
  await waitFor(() => expect(search).toHaveFocus())
  return { user, onModelChange, search }
}

beforeEach(() => {
  localStorage.clear()
  viewport(false)
  // Radix/cmdk measure these platform APIs; jsdom supplies neither.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useModelsStore.setState({ models, isLoading: false, error: null, fetchAll: initialFetchAll })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ModelSelector real interaction contracts', () => {
  it('searches the connection source and preserves duplicate-model identity', async () => {
    const { user, search, onModelChange } = await openSelector()
    await user.type(search, '工作连接乙')
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-selected', 'false')
    await user.click(within(rows[0]).getByRole('button', { name: /工作连接乙/ }))
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(duplicate)
    expect(JSON.parse(localStorage.getItem('recent-models')!)).toEqual([modelKeyFor(duplicate)])
    expect(screen.queryByPlaceholderText('搜索模型 / 厂商 / 能力')).not.toBeInTheDocument()
  })

  it('favorites a duplicate by keyboard without selecting it or dismissing the panel', async () => {
    const { user, search, onModelChange } = await openSelector()
    await user.type(search, '工作连接乙')
    const favorite = within(screen.getByRole('listitem')).getByRole('button', { name: '收藏' })
    favorite.focus()
    await user.keyboard('{Enter}')
    expect(onModelChange).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('favorite-models')!)).toEqual([modelKeyFor(duplicate)])
    expect(screen.getByPlaceholderText('搜索模型 / 厂商 / 能力')).toBeInTheDocument()
    expect(within(screen.getByRole('listitem')).getByRole('button', { name: '取消收藏' })).toBeInTheDocument()
  })

  it('filters capabilities and restores all models without firing selection', async () => {
    const { user, onModelChange } = await openSelector()
    await user.click(screen.getByRole('button', { name: '绘图' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(within(screen.getByRole('listitem')).getByText('GPT Image')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '全部' }))
    await user.click(screen.getByRole('button', { name: /OpenAI/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(useModelsStore.getState().models).toHaveLength(3)
    expect(onModelChange).not.toHaveBeenCalled()
  })

  it('separates empty favorites, recent history, search misses and a successful empty catalog', async () => {
    const { user, search, onModelChange } = await openSelector()
    await user.click(within(screen.getByRole('group', { name: '模型筛选' })).getByRole('button', { name: '收藏' }))
    expect(screen.getByText('还没有收藏的模型')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '最近' }))
    expect(screen.getByText('最近没有使用记录')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '全部' }))
    await user.type(search, '不存在的模型关键词')
    expect(screen.getByText('没有匹配的模型，试试其他关键词')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(search).toHaveValue('')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(onModelChange).not.toHaveBeenCalled()
  })

  it('shows real source, capability and context values and preserves saved favorite identity', async () => {
    localStorage.setItem('favorite-models', JSON.stringify([modelKeyFor(duplicate)]))
    const { user, onModelChange } = await openSelector()
    await user.click(within(screen.getByRole('group', { name: '模型筛选' })).getByRole('button', { name: '收藏' }))
    const row = screen.getByRole('listitem')
    expect(within(row).getByText(/工作连接乙/)).toBeInTheDocument()
    expect(within(row).getByText('视觉')).toBeInTheDocument()
    expect(within(row).getByText(/128k 上下文/i)).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '取消收藏' })).toHaveAttribute('aria-pressed', 'true')
    expect(onModelChange).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByPlaceholderText('搜索模型 / 厂商 / 能力')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveFocus()
  })

  it('shows a successful empty catalog without inventing an error', async () => {
    useModelsStore.setState({ models: [] })
    await openSelector()
    expect(screen.getByText('暂无可用模型')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('announces loading without replacing the catalog with an empty state', async () => {
    useModelsStore.setState({ models: [], isLoading: true })
    await openSelector()
    expect(screen.getByRole('status', { name: '正在加载模型' })).toBeInTheDocument()
    expect(screen.queryByText('暂无可用模型')).not.toBeInTheDocument()
  })

  it('retains the previous catalog after refresh fails and exposes the refresh error', async () => {
    const fetchAll = vi.fn(async () => {
      useModelsStore.setState({ isLoading: false, error: '刷新目录失败' })
    })
    useModelsStore.setState({ fetchAll })
    const { user, onModelChange } = await openSelector()
    await user.click(screen.getByRole('button', { name: '刷新模型目录' }))
    expect(fetchAll).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /OpenAI/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(useModelsStore.getState().models).toHaveLength(3)
    expect(screen.getByRole('alert')).toHaveTextContent('刷新目录失败')
    expect(onModelChange).not.toHaveBeenCalled()
  })

  it('keeps full selected model text in the inline trigger', () => {
    render(<ModelSelector selectedModelId={modelKeyFor(primary)} onModelChange={vi.fn()} variant="inline" />)
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveTextContent(longName)
  })

  it('selects the searched model with ArrowDown and Enter and restores trigger focus', async () => {
    const { user, search, onModelChange } = await openSelector()
    await user.type(search, '工作连接乙')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(duplicate)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveFocus())
  })

  it('provides a visible close action in the mobile bottom sheet and restores trigger focus', async () => {
    viewport(true)
    const { user } = await openSelector()
    const dialog = screen.getByRole('dialog', { name: '选择模型' })
    const close = within(dialog).getByRole('button', { name: /关闭|Close/i })
    expect(close).toBeVisible()
    await user.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '选择模型' })).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveFocus()
  })

  it('distinguishes a model catalog request error from an empty directory and offers retry', async () => {
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    useModelsStore.setState({ models: [], error: '目录暂时不可达', fetchAll })
    const { user } = await openSelector()
    expect(screen.getByRole('alert')).toHaveTextContent('目录暂时不可达')
    expect(screen.queryByText('暂无可用模型')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(fetchAll).toHaveBeenCalledTimes(1)
  })
})
