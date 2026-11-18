import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { parseSystemSettingsPayload } from '@aichat/shared/settings-codec'
import userEvent from '@testing-library/user-event'
import { MODEL_REASONING_EFFORTS, ModelSelector } from '@/components/model-selector'
import { MODEL_REASONING_EFFORT_OPTIONS, filterEffortOptions } from '@/components/model-selector/model-selector-effort'
import { modelKeyFor } from '@/store/model-preference-store'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  duplicate, efforts, effortOption, longName, prepareSelectorTest, primary, viewport, type Effort,
} from './model-selector-fixtures'

interface CombinedHarnessProps {
  initialEffort?: Effort
  effortDisabled?: boolean
  onModelChange?: (model: ModelItem) => void
  onEffortChange?: (value: Effort) => void
}

/** Keeps the controlled values in sync so the trigger and checkmarks can be observed changing. */
function CombinedHarness({ initialEffort = 'unset', effortDisabled, onModelChange, onEffortChange }: CombinedHarnessProps) {
  const [modelId, setModelId] = useState<string | null>(modelKeyFor(primary))
  const [effort, setEffort] = useState<Effort>(initialEffort)
  return (
    <ModelSelector
      selectedModelId={modelId}
      onModelChange={model => { setModelId(modelKeyFor(model)); onModelChange?.(model) }}
      reasoningControl={{ value: effort, disabled: effortDisabled, onChange: value => { setEffort(value); onEffortChange?.(value) } }}
    />
  )
}

async function openCombined(props: CombinedHarnessProps = {}) {
  const user = userEvent.setup()
  render(<CombinedHarness {...props} />)
  await user.click(screen.getByRole('combobox', { name: '选择模型' }))
  const search = await screen.findByRole('textbox', { name: /搜索模型/ })
  await waitFor(() => expect(search).toHaveFocus())
  return { user, search }
}

beforeEach(prepareSelectorTest)
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSettingsStore.setState({ systemSettings: null, reasoningEffortFallback: undefined }) })

describe('ModelSelector combined model and reasoning effort', () => {
  it('echoes the chosen model and its effort in one trigger', () => {
    render(<CombinedHarness initialEffort="max" />)
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toHaveTextContent(longName)
    expect(trigger).toHaveTextContent('Max')
    expect(trigger).toHaveAttribute('title', expect.stringContaining('Max'))
  })

  it('shows the default effort wording for unset without naming a model value', () => {
    render(<CombinedHarness initialEffort="unset" />)
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toHaveTextContent('默认')
    expect(trigger).not.toHaveTextContent('Max')
  })

  it('displays the inherited effort without selecting it as a conversation override', async () => {
    useSettingsStore.setState({ systemSettings: parseSystemSettingsPayload({ openai_reasoning_effort: 'max' }) })
    const onEffortChange = vi.fn()
    const { user } = await openCombined({ onEffortChange })
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toHaveTextContent('Max')
    expect(trigger).not.toHaveTextContent('默认')
    const footer = screen.getByRole('button', { name: '思考强度，当前 Max' })
    await user.click(footer)
    const list = screen.getByRole('list', { name: '思考强度选项' })
    expect(within(list).getByRole('button', { name: /^默认/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(list).getByRole('button', { name: 'Max' })).toHaveAttribute('aria-pressed', 'false')
    expect(onEffortChange).not.toHaveBeenCalled()
    act(() => useSettingsStore.setState({ systemSettings: parseSystemSettingsPayload({ openai_reasoning_effort: 'high' }) }))
    expect(trigger).toHaveTextContent('High')
    await user.click(within(list).getByRole('button', { name: 'Max' }))
    expect(trigger).toHaveTextContent('Max')
    expect(onEffortChange).toHaveBeenCalledExactlyOnceWith('max')
  })

  it.each([
    { fallback: 'xhigh', appliedEfforts: { xhigh: 'high' }, label: 'High' },
    { fallback: 'max', appliedEfforts: {}, label: '默认' },
  ])('shows $label for a signed-in user when the fallback is $fallback', ({ fallback, appliedEfforts, label }) => {
    useModelsStore.setState({ models: [{ ...primary, efforts: ['low', 'high', 'max'], appliedEfforts }] })
    useSettingsStore.setState({ reasoningEffortFallback: fallback })
    render(<CombinedHarness />)
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveTextContent(label)
  })

  it('does not display a pending preference as an effective level when thinking is off', () => {
    render(<CombinedHarness initialEffort="max" effortDisabled />)
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toHaveTextContent('已关闭')
    expect(trigger).not.toHaveTextContent('Max')
  })

  it('reaches the effort list from the panel footer in the same panel', async () => {
    const { user } = await openCombined({ initialEffort: 'high' })
    expect(screen.queryByRole('list', { name: '思考强度选项' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^思考强度/ }))
    const list = screen.getByRole('list', { name: '思考强度选项' })
    expect(list).toBeVisible()
    expect(within(list).getByRole('button', { name: /^High/ })).toHaveAttribute('aria-pressed', 'true')
    for (const value of efforts) expect(within(list).getByRole('button', { name: effortOption(value) })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: /^默认/ })).toHaveAttribute('aria-pressed', 'false')
    const dialog = screen.getByRole('dialog', { name: '选择模型' })
    expect(within(dialog).getByRole('heading', { name: '思考强度' })).toBeInTheDocument()
    expect(within(dialog).getByText(longName)).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it.each([...efforts])('applies %s and returns to the model list', async value => {
    const onEffortChange = vi.fn()
    const { user } = await openCombined({ initialEffort: 'unset', onEffortChange })
    await user.click(screen.getByRole('button', { name: /^思考强度/ }))
    await user.click(within(screen.getByRole('list', { name: '思考强度选项' })).getByRole('button', { name: effortOption(value) }))
    expect(onEffortChange).toHaveBeenCalledExactlyOnceWith(value)
    expect(screen.getByRole('textbox', { name: /搜索模型/ })).toBeVisible()
    expect(screen.queryByRole('list', { name: '思考强度选项' })).not.toBeInTheDocument()
  })

  it('orders the effort rows from default through the strongest setting', async () => {
    const { user } = await openCombined({ initialEffort: 'unset' })
    await user.click(screen.getByRole('button', { name: /^思考强度/ }))
    const list = screen.getByRole('list', { name: '思考强度选项' })
    const rows = Array.from(list.querySelectorAll('[data-effort-row]')).map(row => row.getAttribute('data-effort-row'))
    expect(rows).toEqual(['unset', 'low', 'medium', 'high', 'xhigh', 'max'])
    const expectedLabels = ['默认', 'Low', 'Medium', 'High', 'XHigh', 'Max']
    const buttons = within(list).getAllByRole('button')
    expect(buttons).toHaveLength(expectedLabels.length)
    expectedLabels.forEach((label, index) => {
      expect(buttons[index]).toHaveAccessibleName(new RegExp('^' + label))
    })
  })

  it('keeps the exported effort list in the same ascending order', () => {
    expect([...MODEL_REASONING_EFFORTS]).toEqual(['unset', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('synchronises the trigger with the chosen effort', async () => {
    const { user } = await openCombined({ initialEffort: 'unset' })
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveTextContent('默认')
    await user.click(screen.getByRole('button', { name: /^思考强度/ }))
    await user.click(screen.getByRole('button', { name: /^XHigh/ }))
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveTextContent('XHigh')
  })

  it('returns to the model list from the effort view keeping the search term', async () => {
    const { user, search } = await openCombined()
    await user.type(search, '工作连接甲')
    await user.click(screen.getByRole('button', { name: /^思考强度/ }))
    await user.click(screen.getByRole('button', { name: '返回模型列表' }))
    const restored = screen.getByRole('textbox', { name: /搜索模型/ })
    await waitFor(() => expect(restored).toHaveFocus())
    expect(restored).toHaveValue('工作连接甲')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('keeps the panel open after choosing a model so the effort can follow', async () => {
    const onModelChange = vi.fn()
    const { user, search } = await openCombined({ initialEffort: 'high', onModelChange })
    await user.type(search, '工作连接乙')
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    await user.click(within(rows[0]).getByRole('button', { name: /工作连接乙/ }))
    expect(onModelChange).toHaveBeenCalledExactlyOnceWith(duplicate)
    expect(search).toHaveValue('工作连接乙')
    expect(search).toBeVisible()
    const updated = screen.getAllByRole('listitem')
    expect(updated[0]).toHaveAttribute('data-selected', 'true')
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toHaveAttribute('title', expect.stringContaining('工作连接乙'))
    expect(trigger).toHaveTextContent('High')
    expect(screen.getByRole('button', { name: /^思考强度/ })).toBeEnabled()
  })

  it('opens straight into the effort list for a direct reasoning entry point', async () => {
    const onOpenChange = vi.fn()
    const onEffortChange = vi.fn()
    const user = userEvent.setup()
    function DirectEffortEntry() {
      const [open, setOpen] = useState(false)
      return (
        <ModelSelector
          selectedModelId={modelKeyFor(primary)} onModelChange={vi.fn()}
          reasoningControl={{ value: 'low', onChange: onEffortChange }}
          open={open} onOpenChange={next => { setOpen(next); onOpenChange(next) }}
          defaultView="effort"
        />
      )
    }
    render(<DirectEffortEntry />)
    await user.click(screen.getByRole('combobox', { name: '选择模型' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    const list = await screen.findByRole('list', { name: '思考强度选项' })
    expect(within(list).getByRole('button', { name: /^Low/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(list).getByRole('button', { name: /^Medium/ }))
    expect(onEffortChange).toHaveBeenCalledExactlyOnceWith('medium')
    expect(await screen.findByRole('textbox', { name: /搜索模型/ })).toBeVisible()
  })

  it('honours a disabled reasoning control without blocking model choice', async () => {
    const onEffortChange = vi.fn()
    const { user } = await openCombined({ initialEffort: 'max', effortDisabled: true, onEffortChange })
    const footer = screen.getByRole('button', { name: /^思考强度/ })
    expect(footer).toBeDisabled()
    await user.click(footer)
    expect(screen.queryByRole('list', { name: '思考强度选项' })).not.toBeInTheDocument()
    await user.click(within(screen.getAllByRole('listitem')[2]).getByRole('button'))
    expect(onEffortChange).not.toHaveBeenCalled()
  })

  it('keeps the effort entry reachable while the catalogue fails to load', async () => {
    useModelsStore.setState({ models: [], error: '目录暂时不可达', fetchAll: vi.fn() })
    const { user } = await openCombined({ initialEffort: 'low' })
    expect(screen.getByRole('alert')).toHaveTextContent('目录暂时不可达')
    expect(screen.getByRole('button', { name: /^思考强度/ })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /^思考强度/ }))
    expect(screen.getByRole('list', { name: '思考强度选项' })).toBeVisible()
  })

  it('moves through the effort options with the arrow keys and applies with Enter', async () => {
    const onEffortChange = vi.fn()
    const { user } = await openCombined({ initialEffort: 'unset', onEffortChange })
    await user.click(screen.getByRole('button', { name: /^思考强度/ }))
    expect(screen.getByRole('button', { name: /^默认/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onEffortChange).toHaveBeenCalledExactlyOnceWith('medium')
    expect(screen.getByRole('textbox', { name: /搜索模型/ })).toBeVisible()
  })

  it.each([false, true])('closes from the effort view with Escape on mobile=%s', async mobile => {
    viewport(mobile)
    const { user } = await openCombined({ initialEffort: 'high' })
    await user.click(screen.getByRole('button', { name: /^思考强度/ }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('list', { name: '思考强度选项' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveFocus())
  })

  it('uses the combined sheet title and fixed search on mobile', async () => {
    viewport(true)
    const { user } = await openCombined({ initialEffort: 'low' })
    const dialog = screen.getByRole('dialog', { name: '模型与思考' })
    expect(within(dialog).getByRole('textbox', { name: /搜索模型/ })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: /^思考强度/ })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: /^思考强度/ }))
    expect(within(dialog).getByRole('list', { name: '思考强度选项' })).toBeVisible()
    expect(within(dialog).getByRole('heading', { name: '思考强度' })).toBeInTheDocument()
  })

  it('keeps long model names whole in the list while the trigger stays single-line', async () => {
    const { user } = await openCombined({ initialEffort: 'max' })
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText(longName)).toBeInTheDocument()
    expect(within(rows[0]).getByText(longName)).not.toHaveClass('truncate')
    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(within(trigger).getByText(longName)).toHaveClass('truncate')
    expect(trigger).toHaveTextContent('Max')
    await user.keyboard('{Escape}')
  })

describe('filterEffortOptions', () => {
  it('keeps the default option and only the efforts the model supports', () => {
    expect(filterEffortOptions(['low', 'high'], 'unset').map(option => option.value)).toEqual(['unset', 'low', 'high'])
  })

  it('keeps the current value even when the model does not list it', () => {
    expect(filterEffortOptions(['low', 'high'], 'max').map(option => option.value)).toEqual(['unset', 'low', 'high', 'max'])
  })

  it('does not trim when the model exposes no effort metadata', () => {
    expect(filterEffortOptions(undefined, 'unset').map(option => option.value)).toEqual(
      MODEL_REASONING_EFFORT_OPTIONS.map(option => option.value),
    )
  })
})
})