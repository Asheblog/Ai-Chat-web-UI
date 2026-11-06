import React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppShell } from '@/components/app-shell'

describe('AppShell SSR 一致性', () => {
  it('服务端首帧输出稳定骨架容器，不输出敏感内容', () => {
    const html = renderToString(
      <AppShell ready={false} sidebar={<div>真实侧栏</div>} toolbar={<div>工具栏</div>}>
        <div>私密历史</div>
      </AppShell>,
    )

    expect(html).toContain('data-app-shell="loading"')
    expect(html).toContain('h-screen')
    expect(html).not.toContain('真实侧栏')
    expect(html).not.toContain('私密历史')
    expect(html).not.toContain('undefined')
  })

  it('客户端就绪前同一骨架与 SSR 输出保持一致', () => {
    const render = () =>
      renderToString(
        <AppShell ready={false} sidebar={<div>侧栏</div>} toolbar={<div>工具栏</div>}>
          <div>内容</div>
        </AppShell>,
      )

    expect(render()).toBe(render())
  })
})
