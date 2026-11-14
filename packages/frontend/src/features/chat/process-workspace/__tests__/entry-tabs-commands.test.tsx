import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProcessWorkspaceEntry } from '../process-workspace-entry'
import type { ProcessWorkspaceEntryProps } from '../types'
import type { MessageMeta, ToolEvent } from '@/types'

const meta = (override: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 101,
  sessionId: 5,
  stableKey: 'msg-101',
  role: 'assistant',
  createdAt: '2026-11-14T10:00:00Z',
  reasoningStatus: 'done',
  reasoningDurationSeconds: 87,
  ...override,
})

const event = (id: string, override: Partial<ToolEvent> = {}): ToolEvent => ({
  id,
  callId: id,
  sessionId: 5,
  messageId: 101,
  tool: 'web_search',
  stage: 'result',
  status: 'success',
  createdAt: Date.parse('2026-11-14T10:00:05Z'),
  updatedAt: Date.parse('2026-11-14T10:00:05Z'),
  query: '今日中国新闻',
  ...override,
})

const baseProps: ProcessWorkspaceEntryProps = {
  meta: meta(),
  reasoningRaw: '先确认时间范围，再找原始报道。',
  toolEvents: [event('root'), event('child', { details: { parentCallId: 'root' }, query: '政策原文' })],
  content: '这是正文回答，摘要入口不能吞掉它。',
  artifacts: [],
  coverage: { trace: { status: 'complete', startedAt: 1, turnEndedAt: 2 } },
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('来源与产物', () => {
  it('来源页签按链接去重，清单序号不代表正文引用，来源本身就是外链', async () => {
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        toolEvents={[
          event('s1', { hits: [{ title: '新华社报道', url: 'https://a.example/1' }] }),
          event('s2', { hits: [{ title: '同一链接', url: 'https://a.example/1#part' }] }),
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('tab', { name: /^来源/ }))
    expect(screen.getByText(/共 1 条来源，已按链接去重；序号是本清单顺序，不代表正文引用编号/)).toBeInTheDocument()
    // 不提供"定位到正文"这类没有真实锚点的按钮；来源本身是可点的外链
    expect(screen.queryByRole('button', { name: /定位/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /新华社报道/ })).toHaveAttribute('href', 'https://a.example/1')
  })

  it('来源详情保留主图与图片数，无图不出现空框', async () => {
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        toolEvents={[
          event('read-1', {
            tool: 'read_url',
            query: '政策原文',
            details: {
              url: 'https://a.example/1',
              title: '政策原文',
              leadImageUrl: 'https://img.example/lead.jpg',
              images: [{ url: 'https://img.example/1.jpg' }, { url: 'https://img.example/2.jpg' }],
            },
          }),
          event('read-2', { tool: 'read_url', query: '无图页面', details: { url: 'https://b.example/2', title: '无图页面' } }),
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('tab', { name: /^来源/ }))
    const image = screen.getByRole('img', { name: '政策原文' })
    expect(image).toHaveAttribute('src', 'https://img.example/lead.jpg')
    expect(screen.getByText('主图 · 共 2 张')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })
  it('产物页签使用真实下载链接，过期产物不给假按钮', async () => {
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        artifacts={[
          { id: 1, fileName: '新闻简报.md', mimeType: 'text/markdown', sizeBytes: 2048, expiresAt: '2026-12-01', downloadUrl: '/api/files/1' },
          { id: 2, fileName: '过期报告.pdf', mimeType: 'application/pdf', sizeBytes: 900, expiresAt: '2026-01-01', downloadUrl: '/api/files/2', expired: true },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('tab', { name: /^产物/ }))
    expect(screen.getByText('新闻简报.md')).toBeInTheDocument()
    const download = screen.getByRole('link', { name: /下载/ })
    expect(download).toHaveAttribute('href', '/api/files/1')
    expect(screen.getByText('已过期')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /下载/ })).toHaveLength(1)
  })

  it('空态说明本轮没有工具调用', async () => {
    const user = userEvent.setup()
    render(<ProcessWorkspaceEntry {...baseProps} toolEvents={[]} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    expect(screen.getByText('本轮没有工具调用')).toBeInTheDocument()
  })
})

describe('覆盖与终态', () => {
  it('持久化不完整与列表视图精简分开说明，未知不显示成 0', async () => {
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        coverage={{
          trace: { status: 'unknown' },
          persisted: { status: 'partial', droppedRecords: 454, truncatedFields: 12, asOf: 2 },
          projection: { status: 'partial' },
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    expect(screen.getByText(/持久化记录不完整：丢弃 454 条记录，裁剪 12 个字段/)).toBeInTheDocument()
    expect(screen.getByText('列表视图已精简，打开详情查看')).toBeInTheDocument()
    expect(screen.queryByText(/0 条/)).not.toBeInTheDocument()
  })

  it('finalAnswerGenerated false 显示未生成最终回答，不显示成功徽标', () => {
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        meta={meta({ streamStatus: 'done' })}
        runTerminal={{ finalAnswerGenerated: false, stopReason: 'stop_tools' }}
      />,
    )
    expect(screen.getByText('未生成最终回答')).toBeInTheDocument()
    expect(screen.queryByText('已完成')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /未生成最终回答/ })).toBeInTheDocument()
  })

  it('停止工具后仍有答案时在摘要说明原因', () => {
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        runTerminal={{ stopReason: 'stop_tools', finalAnswerGenerated: true }}
      />,
    )
    expect(screen.getByText('已停止后续工具，用已有资料作答')).toBeInTheDocument()
  })

  it('终态也能从 meta 的 envelope 字段读到', async () => {
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceEntry
        {...baseProps}
        meta={meta({ metadata: { runResult: { stopReason: 'budget_exhausted', finalAnswerGenerated: false } } })}
      />,
    )
    expect(screen.getByText('未生成最终回答')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /未生成最终回答/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('未生成最终回答')
  })
})

describe('命令与只读', () => {
  const streamingProps = {
    ...baseProps,
    isStreaming: true,
    meta: meta({ streamStatus: 'streaming', reasoningStatus: 'streaming' }),
  }

  it('停止工具受理后等待运行事件，不乐观改工具状态', async () => {
    const user = userEvent.setup()
    const onStopTools = vi.fn().mockResolvedValue({ accepted: true })
    render(<ProcessWorkspaceEntry {...streamingProps} commands={{ onStopTools }} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('button', { name: '停止后续工具' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已受理' })).toBeDisabled())
    expect(screen.getByText(/已受理：停止后续工具后仍会用已有资料作答/)).toBeInTheDocument()
    expect(onStopTools).toHaveBeenCalledWith({ sessionId: 5, messageId: 101, clientMessageId: null })
  })

  it('受理被拒或抛错时保留可重试的错误', async () => {
    const user = userEvent.setup()
    const onStopTools = vi.fn()
      .mockResolvedValueOnce({ accepted: false, reason: '该消息已结束' })
      .mockRejectedValueOnce(new Error('网络中断'))
    render(<ProcessWorkspaceEntry {...streamingProps} commands={{ onStopTools }} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('button', { name: '停止后续工具' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('该消息已结束')
    await user.click(screen.getByRole('button', { name: '重试停止请求' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断')
    expect(onStopTools).toHaveBeenCalledTimes(2)
  })

  it('只读分享不渲染任何命令按钮', async () => {
    const user = userEvent.setup()
    const commands = { onStopTools: vi.fn(), onCancelRun: vi.fn(), onRegenerate: vi.fn() }
    render(<ProcessWorkspaceEntry {...streamingProps} readOnly commands={commands} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    expect(screen.queryByRole('button', { name: '停止后续工具' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消本轮' })).not.toBeInTheDocument()
    expect(screen.getByText('只读分享')).toBeInTheDocument()
  })

  it('Battle 的 sessionId 0 即使没传 readOnly 也不发 chat 命令', async () => {
    const user = userEvent.setup()
    const commands = { onStopTools: vi.fn(), onCancelRun: vi.fn() }
    render(
      <ProcessWorkspaceEntry
        {...streamingProps}
        meta={{ ...streamingProps.meta, sessionId: 0 }}
        commands={commands}
      />,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    expect(screen.queryByRole('button', { name: '停止后续工具' })).not.toBeInTheDocument()
    expect(screen.getByText('Battle 只读')).toBeInTheDocument()
  })

  it('完成后提供整轮重新生成，且不冒充单次工具重试', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    render(<ProcessWorkspaceEntry {...baseProps} commands={{ onRegenerate }} />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    await user.click(screen.getByRole('button', { name: '重新生成整轮' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /重试该工具/ })).not.toBeInTheDocument()
  })
})