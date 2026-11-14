import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { ConfigStep } from './ConfigStep'
import { ModelStatsTable } from './ModelStatsTable'

vi.mock('@/components/model-selector', () => ({ ModelSelector: () => <div /> }))
vi.mock('@/components/chat/custom-request-editor', () => ({ CustomRequestEditor: () => null }))
vi.mock('@/store/models-store', () => ({ useModelsStore: () => ({ models: [{}], fetchAll: vi.fn() }) }))
vi.mock('@/store/settings-store', () => ({ useSettingsStore: (select: any) => select({ systemSettings: {}, isLoading: false, fetchSystemSettings: vi.fn() }) }))
afterEach(cleanup)

const source = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8')

describe('Ink & Mist battle interactions', () => {
  it('names model removal and keeps its desktop and mobile hit targets', () => {
    const onRemoveModel = vi.fn()
    const model = { key: 'global:model', model: { id: 'model', name: '长名称模型 / DeepSeek-V3', provider: 'test' }, webSearchEnabled: false, pythonEnabled: false, reasoningEnabled: false, reasoningEffort: 'medium' as const, extraPrompt: '', customBody: '', customHeaders: [], advancedOpen: false }
    render(<ConfigStep selectedModels={[model as any]} judgeConfig={{ model: null, threshold: 0.8, runsPerModel: 1, passK: 1, maxConcurrency: 3 }} onAddModel={vi.fn()} onRemoveModel={onRemoveModel} onUpdateModelConfig={vi.fn()} onJudgeConfigChange={vi.fn()} onNext={vi.fn()} canProceed={false} />)
    const remove = screen.getByRole('button', { name: '移除模型 长名称模型 / DeepSeek-V3' })
    expect(remove.className).toContain('h-11')
    expect(remove.className).toContain('sm:h-8')
    fireEvent.click(remove)
    expect(onRemoveModel).toHaveBeenCalledWith('global:model')
  })

  it('uses neutral numbered ranks and keeps genuine failure color', () => {
    const result = { modelId: 'model', attemptIndex: 1, output: '', error: '真实失败' }
    const { container } = render(<ModelStatsTable groupedResults={[{ key: 'model', label: '模型 A', attempts: [result] }]} statsMap={new Map()} />)
    expect(screen.getByLabelText('第 1 名')).toHaveTextContent('01')
    expect(container.querySelector('[class*="yellow"], [class*="amber"]')).toBeNull()
    expect(screen.getByText('错误').className).toContain('destructive')
  })

  it('shows one creation action rather than a one-choice mode picker', () => {
    const landing = source('app/main/battle/page.tsx')
    expect(landing).toContain('新建多模型对战')
    expect(landing).toContain('/main/battle/multi-model')
    expect(landing).not.toContain('选择模式')
  })

  it('reveals sidebar actions on keyboard focus with adequate targets', () => {
    const sidebar = source('components/sidebar.tsx')
    expect(sidebar).toContain('group-focus-within:opacity-100')
    expect(sidebar).toContain('h-11 w-11')
    expect(sidebar).toContain('sm:h-8 sm:w-8')
  })
})
