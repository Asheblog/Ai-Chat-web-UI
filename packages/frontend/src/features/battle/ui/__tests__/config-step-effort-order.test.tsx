import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ConfigStep } from '../ConfigStep'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { useSettingsStore } from '@/store/settings-store'
import type { JudgeConfig, ModelConfigState } from '../../hooks/types'

// jsdom 未实现 Pointer Capture / scrollIntoView，Radix Select 打开菜单依赖它们。
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const model: ModelItem = {
  id: 'battle-model', rawId: 'battle-model', name: 'BATTLE 模型', provider: 'openai',
  displayName: '对战连接', channelName: '对战连接', connectionId: 21,
  connectionBaseUrl: 'https://fixture.invalid',
}

const effortItem: ModelConfigState = {
  key: 'battle-model-1',
  model,
  webSearchEnabled: false,
  pythonEnabled: false,
  reasoningEnabled: true,
  reasoningEffort: 'max',
  extraPrompt: '',
  customBody: '',
  customHeaders: [],
  advancedOpen: false,
}

const judgeConfig: JudgeConfig = { model: null, threshold: 70, runsPerModel: 3, passK: 3, maxConcurrency: 2 }

function renderConfigStep() {
  return render(
    <ConfigStep
      selectedModels={[effortItem]}
      judgeConfig={judgeConfig}
      onAddModel={vi.fn()}
      onRemoveModel={vi.fn()}
      onUpdateModelConfig={vi.fn()}
      onJudgeConfigChange={vi.fn()}
      onNext={vi.fn()}
      canProceed
    />,
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // 桌面断点：模型选择器据此选择 Popover 而非底部 Sheet。
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })))
  useModelsStore.setState({ models: [model], isLoading: false, error: null, fetchAll: vi.fn() })
  useSettingsStore.setState({
    systemSettings: null,
    isLoading: false,
    error: null,
    fetchSystemSettings: vi.fn(async () => {}),
  } as never)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ConfigStep reasoning effort options', () => {
  test('思考强度选项按 低 → 中 → 高 → 极高 → 最高 排列，Max 最后', async () => {
    renderConfigStep()

    await userEvent.click(screen.getByRole('combobox', { name: '思考强度' }))
    const options = await screen.findAllByRole('option')

    expect(options.map(option => option.textContent?.trim())).toEqual(['低', '中', '高', '极高', '最高'])
  })
})
