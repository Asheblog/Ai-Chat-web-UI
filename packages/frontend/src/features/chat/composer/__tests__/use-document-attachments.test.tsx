import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDocumentAttachments } from '../use-document-attachments'

const limits = {
  maxFileSize: 50 * 1024 * 1024,
  allowedTypes: ['pdf', 'docx', 'doc', 'csv', 'txt', 'md'],
}

describe('useDocumentAttachments', () => {
  it('restores draft documents from sessionStorage when sessionId is null', async () => {
    const toast = vi.fn()
    const draftKey = 'test:welcome:documents:draft'

    sessionStorage.setItem(
      draftKey,
      JSON.stringify({
        version: 1,
        documents: [
          {
            id: 123,
            filename: 'doc-123.pdf',
            originalName: 'spec.pdf',
            mimeType: 'application/pdf',
            fileSize: 1024,
            status: 'ready',
          },
        ],
      }),
    )

    const { result } = renderHook(() =>
      useDocumentAttachments({
        sessionId: null,
        limits,
        toast,
        draftKey,
      }),
    )

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(1)
    })
    expect(result.current.documents[0].id).toBe(123)
    expect(result.current.documents[0].originalName).toBe('spec.pdf')
  })

  it('clearDocuments clears sessionStorage draft', async () => {
    const toast = vi.fn()
    const draftKey = 'test:welcome:documents:draft:clear'

    sessionStorage.setItem(
      draftKey,
      JSON.stringify({
        version: 1,
        documents: [
          {
            id: 456,
            filename: 'doc-456.pdf',
            originalName: 'draft.pdf',
            mimeType: 'application/pdf',
            fileSize: 2048,
            status: 'ready',
          },
        ],
      }),
    )

    const { result } = renderHook(() =>
      useDocumentAttachments({
        sessionId: null,
        limits,
        toast,
        draftKey,
      }),
    )

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(1)
    })

    act(() => {
      result.current.clearDocuments()
    })

    expect(sessionStorage.getItem(draftKey)).toBeNull()

    await waitFor(() => {
      expect(result.current.documents).toHaveLength(0)
    })
  })
})

