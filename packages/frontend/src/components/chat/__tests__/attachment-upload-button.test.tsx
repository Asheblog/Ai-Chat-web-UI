import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AttachmentUploadButton } from '@/components/chat/attachment-upload-button'

describe('AttachmentUploadButton', () => {
  it('renders a paperclip button without text', () => {
    const onPick = vi.fn()
    render(<AttachmentUploadButton onPick={onPick} />)

    const button = screen.getByRole('button', { name: /上传附件/i })
    expect(button).toBeInTheDocument()
    // Button should be icon-only — no visible text
    expect(button.textContent?.trim()).toBe('')
  })

  it('calls onPick when clicked', () => {
    const onPick = vi.fn()
    render(<AttachmentUploadButton onPick={onPick} />)

    fireEvent.click(screen.getByRole('button', { name: /上传附件/i }))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('does NOT render any dropdown menu, sheet, or text like "图片上传" / "文件上传" / "附件管理" / "知识库"', () => {
    const onPick = vi.fn()
    const { container } = render(<AttachmentUploadButton onPick={onPick} />)

    expect(container.textContent).not.toContain('图片上传')
    expect(container.textContent).not.toContain('文件上传')
    expect(container.textContent).not.toContain('附件管理')
    expect(container.textContent).not.toContain('知识库')

    // Should not contain Radix dropdown/sheet primitives
    expect(container.querySelector('[data-radix-popper-content-wrapper]')).toBeNull()
  })

  it('shows tooltip with supported file types', () => {
    const onPick = vi.fn()
    render(<AttachmentUploadButton onPick={onPick} />)

    const button = screen.getByRole('button', { name: /上传附件/i })
    expect(button).toHaveAttribute('title')
    expect(button.getAttribute('title')).toMatch(/PDF|图片|Excel|CSV|文本|代码/i)
  })

  it('respects disabled state', () => {
    const onPick = vi.fn()
    render(<AttachmentUploadButton onPick={onPick} disabled />)

    const button = screen.getByRole('button', { name: /上传附件/i })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onPick).not.toHaveBeenCalled()
  })
})
