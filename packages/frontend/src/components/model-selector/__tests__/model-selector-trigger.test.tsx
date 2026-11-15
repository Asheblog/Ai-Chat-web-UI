import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModelSelectorTrigger } from '@/components/model-selector/model-selector-trigger'
import { formatModelShortName } from '@/components/model-selector/model-selector-utils'
import type { ModelItem } from '@/store/models-store'

const model: ModelItem = {
  id: 'deepseek-v4.1-flash', rawId: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash',
  provider: 'openai', displayName: '工作区主连接', channelName: '工作区主连接',
  connectionId: 7, connectionBaseUrl: 'https://fixture.invalid',
}

describe('ModelSelectorTrigger', () => {
  it('keeps the legacy accessible name and shows model plus effort', () => {
    render(
      <ModelSelectorTrigger
        open={false} selected={model} displayVariant="inline" selectorSize="md" effort="max"
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toHaveTextContent('DeepSeek V4.1 Flash')
    expect(trigger).toHaveTextContent('Max')
    expect(trigger.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('leaves the legacy pure-model trigger without a new description dependency', () => {
    render(
      <ModelSelectorTrigger
        open={false} selected={model} displayVariant="inline" selectorSize="md"
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    expect(trigger).toHaveTextContent('DeepSeek V4.1 Flash')
    expect(trigger).not.toHaveAttribute('aria-describedby')
  })

  it('describes the full model identity and effort for screen readers in combined mode', () => {
    render(
      <ModelSelectorTrigger
        open={false} selected={model} displayVariant="inline" selectorSize="md" effort="high"
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    const describedBy = trigger.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const description = document.getElementById(describedBy as string)
    expect(description?.textContent).toContain('DeepSeek V4.1 Flash')
    expect(description?.textContent).toContain('High')
    expect(description?.textContent).toContain('工作区主连接')
    expect(trigger.getAttribute('title')).toContain('DeepSeek V4.1 Flash')
  })

  it('renders a display-only short name while keeping the full title and description', () => {
    render(
      <ModelSelectorTrigger
        open={false} selected={model} displayVariant="inline" selectorSize="md" effort="max"
        formatTriggerName={formatModelShortName}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '选择模型' })
    // 可见文本是短名；完整身份只出现在 title 与 sr-only 描述里。
    expect(trigger.querySelector('.font-medium')?.textContent).toBe('V4.1 Flash')
    expect(trigger.getAttribute('title')).toContain('DeepSeek V4.1 Flash')
    const describedBy = trigger.getAttribute('aria-describedby') as string
    expect(document.getElementById(describedBy)?.textContent).toContain('DeepSeek V4.1 Flash')
  })
})

describe('formatModelShortName', () => {
  it('drops a bare vendor prefix only when the rest carries a version number', () => {
    expect(formatModelShortName('DeepSeek V4.1 Flash')).toBe('V4.1 Flash')
    expect(formatModelShortName('Claude Sonnet 4.5')).toBe('Sonnet 4.5')
    expect(formatModelShortName('Gemini 2.5 Pro')).toBe('2.5 Pro')
  })

  it('keeps ordinary names that cannot be shortened reliably', () => {
    expect(formatModelShortName('GPT-4.1')).toBe('GPT-4.1')
    expect(formatModelShortName('Qwen Max')).toBe('Qwen Max')
    expect(formatModelShortName('通义千问 Max')).toBe('通义千问 Max')
    expect(formatModelShortName('GPT-4.1 超长中文模型名称 · 产品研发工作专用连接')).toBe(
      'GPT-4.1 超长中文模型名称 · 产品研发工作专用连接',
    )
    expect(formatModelShortName('  ')).toBe('  ')
  })
})
