import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonalSecurityPage } from '../pages/PersonalSecurity'
vi.mock('@/features/auth/api', () => ({ changePassword: vi.fn() }))
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
afterEach(cleanup)
it('密码折叠面板使用关联表单标签和可读错误状态', () => {
 render(<PersonalSecurityPage />)
 const expand=screen.getByRole('button',{name:/安全设置/})
 fireEvent.click(expand)
 expect(expand).toHaveAttribute('aria-controls')
 expect(screen.getByLabelText('当前密码')).toHaveAttribute('autocomplete','current-password')
 expect(screen.getByLabelText('新密码')).toHaveAttribute('autocomplete','new-password')
 expect(screen.getByLabelText('确认新密码')).toBeInTheDocument()
 for (const name of ['当前密码', '新密码', '确认新密码']) {
   expect(screen.getByLabelText(name)).toHaveClass('h-11', 'sm:h-10')
 }
 expect(screen.getByRole('button', { name: '保存更改' })).toHaveClass('h-11', 'sm:h-9')
 fireEvent.submit(screen.getByLabelText('当前密码').closest('form')!)
 expect(screen.getByRole('alert')).toHaveTextContent('请填写当前密码')
})
