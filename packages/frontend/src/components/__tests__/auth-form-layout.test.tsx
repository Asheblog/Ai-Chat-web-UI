import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthFormLayout } from '@/components/auth-form-layout'

describe('AuthFormLayout', () => {
  it('renders title and description when provided', () => {
    render(
      <AuthFormLayout title="登录" description="登录账号以继续使用">
        <div>表单内容</div>
      </AuthFormLayout>
    )

    expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument()
    expect(screen.getByText('登录账号以继续使用')).toBeInTheDocument()
    expect(screen.getByText('表单内容')).toBeInTheDocument()
  })

  it('omits the header block when title is not provided', () => {
    render(
      <AuthFormLayout>
        <div>表单内容</div>
      </AuthFormLayout>
    )

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('表单内容')).toBeInTheDocument()
  })
})
