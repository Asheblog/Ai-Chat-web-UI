import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SettingRow } from '../components/setting-row'
afterEach(cleanup)
it('设置行关联字段标签并约束固定宽控件不撑开内容列', () => {
 render(<SettingRow title="端点地址" htmlFor="endpoint" description={'长模块/'.repeat(20)}><input id="endpoint" style={{width:320}} /></SettingRow>)
 const input=screen.getByLabelText('端点地址')
 expect(input.parentElement?.className).toContain('[&>input]:max-w-full')
 expect(screen.getByText('端点地址').parentElement?.className).toContain('[overflow-wrap:anywhere]')
})
