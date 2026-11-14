import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsShell } from '../shell'
afterEach(cleanup)
it('移动设置目录默认折叠并在切换叶子后关闭', () => {
 const change=vi.fn();const props={sections:[{key:'one',label:'个人资料'},{key:'two',label:'账号安全'}],active:'one',onChange:change}
 const {rerender}=render(<SettingsShell {...props}><div>页面正文</div></SettingsShell>)
 const toggle=screen.getByRole('button',{name:'打开设置目录'})
 expect(toggle).toHaveAttribute('aria-expanded','false')
 expect(screen.getByText('当前：个人资料')).toBeInTheDocument()
 fireEvent.click(toggle)
 expect(screen.getByRole('button',{name:'收起设置目录'})).toHaveAttribute('aria-expanded','true')
 fireEvent.click(screen.getByRole('button',{name:'账号安全'}))
 expect(change).toHaveBeenCalledWith('two')
 rerender(<SettingsShell {...props} active="two"><div>页面正文</div></SettingsShell>)
 expect(screen.getByRole('button',{name:'打开设置目录'})).toHaveAttribute('aria-expanded','false')
 expect(screen.getByText('当前：账号安全')).toBeInTheDocument()
})
