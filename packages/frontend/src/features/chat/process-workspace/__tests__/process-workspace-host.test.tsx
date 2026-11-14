import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ProcessWorkspaceHost, useProcessWorkspaceOpen } from '../process-workspace-host'
import { ProcessWorkspaceEntry } from '../process-workspace-entry'
import type { MessageMeta, ToolEvent } from '@/types'

const meta: MessageMeta = {
  id: 301,
  sessionId: 9,
  stableKey: 'msg-301',
  role: 'assistant',
  createdAt: '2026-11-14T10:00:00Z',
  reasoningStatus: 'done',
  reasoningDurationSeconds: 236,
}
const events = (): ToolEvent[] => [
  { id: 'r1', callId: 'r1', sessionId: 9, messageId: 301, tool: 'web_search', stage: 'result', status: 'success', createdAt: 1, query: '中国新闻' },
  { id: 'c1', callId: 'c1', sessionId: 9, messageId: 301, tool: 'read_url', stage: 'result', status: 'success', createdAt: 2, query: '政策原文', details: { parentCallId: 'r1' } },
]

const stubMatchMedia = (wide: boolean) => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: query.includes('1440') ? wide : wide,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function OpenProbe() {
  const open = useProcessWorkspaceOpen()
  return <span data-testid="open-flag">{String(open)}</span>
}

describe('ProcessWorkspaceHost 内联双栏', () => {
  it('≥1440 打开的是内联侧栏而不是覆盖抽屉', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceHost>
        <OpenProbe />
        <ProcessWorkspaceEntry meta={meta} reasoningRaw="思考" toolEvents={events()} />
      </ProcessWorkspaceHost>,
    )
    expect(screen.getByTestId('open-flag')).toHaveTextContent('false')
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    const aside = await screen.findByRole('complementary', { name: '过程工作区' })
    expect(within(aside).getByRole('tablist', { name: '工作区页签' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('open-flag')).toHaveTextContent('true')
  })

  it('侧栏 440px、Esc 关闭并把焦点还给摘要按钮', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceHost>
        <ProcessWorkspaceEntry meta={meta} reasoningRaw="思考" toolEvents={events()} />
      </ProcessWorkspaceHost>,
    )
    const trigger = screen.getByRole('button', { name: /查看过程/ })
    await user.click(trigger)
    const aside = await screen.findByRole('complementary', { name: '过程工作区' })
    expect(aside).toHaveStyle({ width: '440px' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '过程工作区' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('中屏打开覆盖抽屉，关闭后 open 标记复位', async () => {
    stubMatchMedia(false)
    const user = userEvent.setup()
    render(
      <ProcessWorkspaceHost>
        <OpenProbe />
        <ProcessWorkspaceEntry meta={meta} reasoningRaw="思考" toolEvents={events()} />
      </ProcessWorkspaceHost>,
    )
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭工作区' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('open-flag')).toHaveTextContent('false')
  })

  it('消息行被卸载后仍显示最后一份实时快照', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()

    function Harness() {
      const [mounted, setMounted] = useState(true)
      return (
        <ProcessWorkspaceHost>
          <button type="button" onClick={() => setMounted(false)}>卸载消息行</button>
          {mounted && <ProcessWorkspaceEntry meta={meta} reasoningRaw="思考" toolEvents={events()} />}
        </ProcessWorkspaceHost>
      )
    }

    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    const aside = await screen.findByRole('complementary', { name: '过程工作区' })
    await user.click(screen.getByRole('button', { name: '卸载消息行' }))
    expect(within(aside).getByText(/联网搜索：中国新闻/)).toBeInTheDocument()
  })

  it('流式新快照不抢走面板内输入框的焦点', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()

    function Harness() {
      const [streamed, setStreamed] = useState(0)
      return (
        <ProcessWorkspaceHost>
          <button type="button" onClick={() => setStreamed((current) => current + 1)}>发布新快照</button>
          <ProcessWorkspaceEntry
            meta={meta}
            reasoningRaw="思考"
            toolEvents={events().concat(Array.from({ length: streamed }, (_, index) => ({
              id: 'live-' + index,
              callId: 'live-' + index,
              sessionId: 9,
              messageId: 301,
              tool: 'web_search',
              stage: 'result' as const,
              status: 'success' as const,
              createdAt: 100 + index,
              query: '追加 ' + index,
            })))}
            isStreaming
          />
        </ProcessWorkspaceHost>
      )
    }

    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /查看过程/ }))
    const search = await screen.findByRole('searchbox', { name: '搜索调用' })
    await user.click(search)
    await user.type(search, '中国')
    // 用 fireEvent 发布：真实点击会把焦点交给按钮，这里要测的是 publish 不抢焦点
    fireEvent.click(screen.getByRole('button', { name: '发布新快照' }))
    // 新快照确实进了面板（记录数/父调用数变化）
    await waitFor(() => expect(screen.getByText(/^3 条记录/)).toBeInTheDocument())
    // 但焦点和已输入内容都留在搜索框，没有被 publish 抢走
    expect(search).toHaveFocus()
    expect(search).toHaveValue('中国')
  })

  it('没有宿主时 useProcessWorkspaceOpen 返回 false 且不报错', () => {
    stubMatchMedia(true)
    render(<OpenProbe />)
    expect(screen.getByTestId('open-flag')).toHaveTextContent('false')
  })
})
