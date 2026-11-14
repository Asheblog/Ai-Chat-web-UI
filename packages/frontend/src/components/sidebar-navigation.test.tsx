import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('侧栏信息层级', () => {
  it('keeps only new chat above the list and quiet navigation below it', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/sidebar.tsx'), 'utf8')
    const primary = source.slice(source.indexOf('{/* 顶部新建聊天按钮 */}'), source.indexOf('{/* 会话列表 */}'))
    expect(primary).toContain('新建聊天')
    expect(primary).not.toContain('模型对战')
    expect(primary).not.toContain('onClick={openSettings}')
    const footer = source.slice(source.indexOf('</ScrollArea>'), source.indexOf('const collapsedSidebar'))
    expect(footer).toContain('aria-label="主导航"')
    expect(footer).toContain("router.push('/main/battle')")
    expect(footer).toContain('onClick={openSettings}')
  })
})
