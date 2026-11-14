import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthFormLayout } from '@/components/auth-form-layout'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
describe('认证表单语义', () => {
  it('shows a description without requiring a duplicate title', () => {
    render(<AuthFormLayout description="用户名密码登录" error="服务错误"><span>内容</span></AuthFormLayout>)
    expect(screen.getByText('用户名密码登录')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('服务错误')
  })
  it('links password mismatch feedback and announces approval status', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/auth/register/register-client.tsx'), 'utf8')
    expect(source).toContain('aria-describedby={passwordError')
    expect(source).toContain('role="status"')
    expect(source).toContain('autoComplete="new-password"')
    expect(source).not.toContain('type="email"')
  })
})
