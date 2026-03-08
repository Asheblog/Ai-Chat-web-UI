import { DocumentToolHandler } from './document-tools'

describe('DocumentToolHandler workspace bridge tools', () => {
  it('returns workspace normalized path for ready document', async () => {
    const documentService = {
      getSessionDocumentIds: jest.fn().mockResolvedValue([10]),
    }

    const bridgeService = {
      syncDocumentToWorkspace: jest.fn().mockResolvedValue({
        sessionId: 1,
        documentId: 10,
        status: 'ready',
        rootRelativePath: 'input/documents/10',
        original: {
          exists: true,
          relativePath: 'input/documents/10/original/spec.pdf',
          fileName: 'spec.pdf',
          mimeType: 'application/pdf',
        },
        normalized: {
          exists: true,
          relativePath: 'input/documents/10/normalized',
          contentPath: 'input/documents/10/normalized/content.md',
          pagesPath: 'input/documents/10/normalized/pages.jsonl',
          tocPath: 'input/documents/10/normalized/toc.json',
        },
      }),
    }

    const handler = new DocumentToolHandler(
      {} as any,
      documentService as any,
      1,
      null,
      null,
      bridgeService as any,
    )

    const result = await handler.handleToolCall('document_get_workspace_path', {
      document_id: 10,
      channel: 'normalized',
    })

    expect(result.success).toBe(true)
    expect((result.result as any).workspacePath).toBe('input/documents/10/normalized/content.md')
  })

  it('syncs all session documents to workspace', async () => {
    const documentService = {
      getSessionDocumentIds: jest.fn().mockResolvedValue([10, 11]),
    }

    const bridges = [
      {
        sessionId: 1,
        documentId: 10,
        status: 'ready',
        rootRelativePath: 'input/documents/10',
        original: {
          exists: true,
          relativePath: 'input/documents/10/original/file.bin',
          fileName: 'file.bin',
          mimeType: 'application/octet-stream',
        },
        normalized: {
          exists: true,
          relativePath: 'input/documents/10/normalized',
          contentPath: 'input/documents/10/normalized/content.md',
          pagesPath: 'input/documents/10/normalized/pages.jsonl',
          tocPath: 'input/documents/10/normalized/toc.json',
        },
      },
      {
        sessionId: 1,
        documentId: 11,
        status: 'pending',
        rootRelativePath: 'input/documents/11',
        original: {
          exists: true,
          relativePath: 'input/documents/11/original/file.bin',
          fileName: 'file.bin',
          mimeType: 'application/octet-stream',
        },
        normalized: {
          exists: false,
          relativePath: 'input/documents/11/normalized',
          contentPath: 'input/documents/11/normalized/content.md',
          pagesPath: 'input/documents/11/normalized/pages.jsonl',
          tocPath: 'input/documents/11/normalized/toc.json',
        },
      },
    ]

    const bridgeService = {
      syncSessionDocumentsToWorkspace: jest.fn().mockResolvedValue(bridges),
    }

    const handler = new DocumentToolHandler(
      {} as any,
      documentService as any,
      1,
      null,
      null,
      bridgeService as any,
    )

    const result = await handler.handleToolCall('document_sync_to_workspace', {})

    expect(result.success).toBe(true)
    expect(bridgeService.syncSessionDocumentsToWorkspace).toHaveBeenCalledWith(1)
    expect((result.result as any).total).toBe(2)
    expect((result.result as any).ready).toBe(1)
    expect((result.result as any).pending).toBe(1)
  })
})
