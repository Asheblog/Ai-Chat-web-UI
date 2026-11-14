import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelSelector } from '@/components/model-selector'
import { modelKeyFor } from '@/store/model-preference-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'

// Exercise the real store, Radix overlays, search and rows without a provider request.
const longName = 'GPT-4.1 超长中文模型名称用于验证当前模型可读与操作区域独立布局'
const primary: ModelItem = {
  id: 'gpt-ui', rawId: 'gpt-ui', name: longName, provider: 'openai',
  displayName: '工作连接甲', channelName: '工作连接甲', connectionBaseUrl: 'https://fixture.invalid',
  connectionId: 11, capabilities: { vision: true }, contextWindow: 128000,
}
const duplicate: ModelItem = { ...primary, connectionId: 12, displayName: '工作连接乙', channelName: '工作连接乙' }
const image: ModelItem = {
  ...primary, id: 'gpt-image', rawId: 'gpt-image', name: 'GPT Image', provider: 'anthropic', connectionId: 13,
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
  const search = await screen.findByRole('textbox', { name: /搜索模型/ })
  await waitFor(() => expect(search).toHaveFocus())
  return { user, onModelChange, search }
}

beforeEach(() => {
  localStorage.clear()
  viewport(false)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
  useModelsStore.setState({ models, isLoading: false, error: null, fetchAll: initialFetchAll })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ModelSelector simple picker contracts', () => {
  it('shows every model once with its real supplier and one selected row', async () => {
    localStorage.setItem('favorite-models', JSON.stringify([modelKeyFor(duplicate)]))
    localStorage.setItem('recent-models', JSON.stringify([modelKeyFor(primary)]))
    await openSelector()
    const rows = within(screen.getByRole('list', { name: '全部模型' })).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.filter(row => row.dataset.selected === 'true')).toHaveLength(1)
    expect(within(rows[0]).getByText('工作连接甲 · OpenAI')).toBeInTheDocument()
    expect(within(rows[2]).getByText('绘图连接 · Anthropic')).toBeInTheDocument()
    for (const row of rows) expect(within(row).getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('group', { name: '模型筛选' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('模型家族')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(收藏|最近|视觉|绘图|刷新模型目录)$/ })).not.toBeInTheDocument()
    expect(screen.queryByText('常用')).not.toBeInTheDocument()
    expect(screen.queryByText(/128k 上下文|视觉/)).not.toBeInTheDocument()
  })

  it('searches supplier names without inferring a supplier from the model family', async () => {
    const { user, search, onModelChange } = await openSelector()
    await user.type(search, 'anthropic')
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('GPT Image')).toBeInTheDocument()
    await user.click(within(rows[0]).getByRole('button', { name: /GPT Image/ }))
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(image)
  })

  it('searches connection sources and selects the exact duplicate identity', async () => {
    const { user, search, onModelChange } = await openSelector()
    await user.type(search, '工作连接乙')
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveAttribute('data-selected', 'false')
    await user.click(within(rows[0]).getByRole('button', { name: /工作连接乙/ }))
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(duplicate)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveFocus())
  })

  it('recovers from a search miss by clearing search without changing selection', async () => {
    const { user, search, onModelChange } = await openSelector()
    await user.type(search, '不存在的模型关键词')
    expect(screen.getByRole('status')).toHaveTextContent('没有找到匹配模型')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(onModelChange).not.toHaveBeenCalled()
  })

  it('treats whitespace as no search and distinguishes a successful empty catalog', async () => {
    useModelsStore.setState({ models: [] })
    const { user, search } = await openSelector()
    await user.type(search, '   ')
    expect(screen.getByRole('status')).toHaveTextContent('暂无可用模型')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refreshes a successful empty catalog without repeating the request while loading', async () => {
    const fetchAll = vi.fn().mockImplementation(async () => {
      useModelsStore.setState({ isLoading: true })
    })
    useModelsStore.setState({ models: [], fetchAll })
    const { user, onModelChange } = await openSelector()
    const refresh = screen.getByRole('button', { name: '刷新模型目录' })
    await user.click(refresh)
    expect(fetchAll).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status', { name: '正在加载模型' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '刷新模型目录' })).not.toBeInTheDocument()
    await user.click(refresh)
    expect(fetchAll).toHaveBeenCalledTimes(1)
    expect(onModelChange).not.toHaveBeenCalled()
  })

  it('deduplicates an identical source and supplier without losing distinct connection names', async () => {
    useModelsStore.setState({ models: [
      { ...primary, displayName: 'OpenAI' },
      { ...duplicate, provider: 'deepseek', displayName: 'DeepSeek' },
      image,
    ] })
    await openSelector()
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('OpenAI')).toBeInTheDocument()
    expect(within(rows[1]).getByText('DeepSeek')).toBeInTheDocument()
    expect(within(rows[2]).getByText('绘图连接 · Anthropic')).toBeInTheDocument()
    expect(screen.queryByText('OpenAI · OpenAI')).not.toBeInTheDocument()
    expect(screen.queryByText('DeepSeek · deepseek')).not.toBeInTheDocument()
  })

  it('announces loading instead of an empty catalog', async () => {
    useModelsStore.setState({ models: [], isLoading: true })
    await openSelector()
    expect(screen.getByRole('status', { name: '正在加载模型' })).toBeInTheDocument()
    expect(screen.queryByText('暂无可用模型')).not.toBeInTheDocument()
  })

  it('keeps loaded models selectable after an error and retries only from the error state', async () => {
    const fetchAll = vi.fn().mockResolvedValue(undefined)
    useModelsStore.setState({ error: '刷新目录失败', fetchAll })
    const { user, onModelChange } = await openSelector()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('alert')).toHaveTextContent('刷新目录失败')
    await user.click(screen.getByRole('button', { name: '重试' }))
    expect(fetchAll).toHaveBeenCalledTimes(1)
    await user.click(within(screen.getAllByRole('listitem')[2]).getByRole('button'))
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(image)
  })

  it('distinguishes a request error from an empty catalog', async () => {
    useModelsStore.setState({ models: [], error: '目录暂时不可达' })
    await openSelector()
    expect(screen.getByRole('alert')).toHaveTextContent('目录暂时不可达')
    expect(screen.queryByText('暂无可用模型')).not.toBeInTheDocument()
  })

  it('does not open or select when disabled and preserves the inline model name', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    render(<ModelSelector selectedModelId={modelKeyFor(primary)} onModelChange={onModelChange} variant="inline" disabled />)
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toHaveTextContent(longName)
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onModelChange).not.toHaveBeenCalled()
  })

  it('selects a searched model with ArrowDown and Enter and restores focus', async () => {
    const { user, search, onModelChange } = await openSelector()
    await user.type(search, '工作连接乙')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(duplicate)
    await waitFor(() => expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveFocus())
  })

  it('navigates the entire flat list with ArrowUp, Home and End', async () => {
    const { user, onModelChange } = await openSelector()
    const rows = screen.getAllByRole('listitem')
    await user.keyboard('{ArrowUp}')
    expect(within(rows[2]).getByRole('button')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(within(rows[0]).getByRole('button')).toHaveFocus()
    await user.keyboard('{End}{Enter}')
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(image)
  })

  it.each([false, true])('closes with Escape and restores focus on mobile=%s', async mobile => {
    viewport(mobile)
    const { user } = await openSelector()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveFocus()
  })

  it('shows all models and a visible close action in the mobile bottom sheet', async () => {
    viewport(true)
    const { user } = await openSelector()
    const dialog = screen.getByRole('dialog', { name: '选择模型' })
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3)
    await user.click(within(dialog).getByRole('button', { name: '关闭模型选择器' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveFocus()
  })
})
