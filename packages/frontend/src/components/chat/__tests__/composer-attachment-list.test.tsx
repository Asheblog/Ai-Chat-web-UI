import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ComposerAttachmentList } from '@/components/chat/composer-attachment-list'
import type { WorkspaceFile } from '@/features/chat/composer'

describe('ComposerAttachmentList', () => {
  it('renders image thumbnails with remove button', () => {
    const onRemoveImage = vi.fn()
    const onRemoveWorkspaceFile = vi.fn()
    render(
      <ComposerAttachmentList
        images={[{ dataUrl: 'data:image/png;base64,abc', mime: 'image/png', size: 1024 }]}
        onRemoveImage={onRemoveImage}
        workspaceFiles={[]}
        onRemoveWorkspaceFile={onRemoveWorkspaceFile}
      />,
    )

    expect(screen.getByRole('button', { name: /移除图片/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /移除图片/i }))
    expect(onRemoveImage).toHaveBeenCalledWith(0)
  })

  it('renders workspace files with status indicators and remove button', () => {
    const onRemoveImage = vi.fn()
    const onRemoveWorkspaceFile = vi.fn()
    const files: WorkspaceFile[] = [
      {
        localId: 'f1',
        filename: 'report.pdf',
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        fileSize: 20480,
        workspacePath: 'input/report.pdf',
        status: 'ready',
      },
      {
        localId: 'f2',
        filename: 'photo.png',
        originalName: 'photo.png',
        mimeType: 'image/png',
        fileSize: 512000,
        workspacePath: 'input/photo.png',
        status: 'uploading',
      },
      {
        localId: 'f3',
        filename: 'failed.xlsx',
        originalName: 'failed.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 102400,
        workspacePath: '',
        status: 'error',
        errorMessage: '413 文件过大',
      },
    ]

    render(
      <ComposerAttachmentList
        images={[]}
        onRemoveImage={onRemoveImage}
        workspaceFiles={files}
        onRemoveWorkspaceFile={onRemoveWorkspaceFile}
      />,
    )

    // All file names should be visible
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.getByText('failed.xlsx')).toBeInTheDocument()

    // Remove buttons for all files
    const removeButtons = screen.getAllByRole('button', { name: /移除/i })
    // 3 files × 1 remove button each = 3, plus 0 images × 1 = 0
    expect(removeButtons.length).toBe(3)

    fireEvent.click(removeButtons[0])
    expect(onRemoveWorkspaceFile).toHaveBeenCalledWith('f1')
  })

  it('shows error icon/text for failed workspace files', () => {
    const onRemoveImage = vi.fn()
    const onRemoveWorkspaceFile = vi.fn()
    const files: WorkspaceFile[] = [
      {
        localId: 'f3',
        filename: '',
        originalName: 'failed.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 102400,
        workspacePath: '',
        status: 'error',
        errorMessage: '413 文件过大',
      },
    ]

    render(
      <ComposerAttachmentList
        images={[]}
        onRemoveImage={onRemoveImage}
        workspaceFiles={files}
        onRemoveWorkspaceFile={onRemoveWorkspaceFile}
      />,
    )

    expect(screen.getByText('failed.xlsx')).toBeInTheDocument()
    expect(screen.getByText('413 文件过大')).toBeInTheDocument()
  })

  it('returns null when no images or workspace files', () => {
    const { container } = render(
      <ComposerAttachmentList
        images={[]}
        onRemoveImage={vi.fn()}
        workspaceFiles={[]}
        onRemoveWorkspaceFile={vi.fn()}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('renders both images and workspace files together', () => {
    const onRemoveImage = vi.fn()
    const onRemoveWorkspaceFile = vi.fn()
    render(
      <ComposerAttachmentList
        images={[{ dataUrl: 'data:image/png;base64,img1', mime: 'image/png', size: 1024 }]}
        onRemoveImage={onRemoveImage}
        workspaceFiles={[
          {
            localId: 'f1',
            filename: 'doc.pdf',
            originalName: 'doc.pdf',
            mimeType: 'application/pdf',
            fileSize: 20480,
            workspacePath: 'input/doc.pdf',
            status: 'ready',
          },
        ]}
        onRemoveWorkspaceFile={onRemoveWorkspaceFile}
      />,
    )

    // Image remove button
    expect(screen.getByRole('button', { name: /移除图片/i })).toBeInTheDocument()
    // Workspace file name
    expect(screen.getByText('doc.pdf')).toBeInTheDocument()
  })
})
