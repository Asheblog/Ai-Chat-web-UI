import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ExportPdfToolHandler } from './export-pdf-handler'
import {
  artifactService,
  setArtifactService,
} from '../../../services/workspace/artifact-service'
import {
  workspaceService,
  setWorkspaceService,
} from '../../../services/workspace/workspace-service'
import type { PdfExportHandlerConfig } from './types'

const baseContext = {
  sessionId: 1,
  actorIdentifier: 'user:1',
  messageId: 7,
  emitReasoning: jest.fn(),
  sendToolEvent: jest.fn(),
  sendStreamEvent: jest.fn(),
}

describe('ExportPdfToolHandler', () => {
  const originalWorkspaceService = workspaceService
  const originalArtifactService = artifactService
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aichat-export-pdf-'))
  })

  afterEach(async () => {
    setWorkspaceService(originalWorkspaceService)
    setArtifactService(originalArtifactService)
    await fs.rm(tempDir, { recursive: true, force: true })
    jest.clearAllMocks()
  })

  it('rejects empty markdown before touching the workspace', async () => {
    const handler = new ExportPdfToolHandler({ enabled: true })
    const result = await handler.handle(
      { id: 'call_1', function: { name: 'export_pdf', arguments: '{}' } },
      { title: 'T', markdown: '' },
      baseContext as any,
    )
    expect(result.message.content).toContain('非空')
    expect(baseContext.sendToolEvent).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'error' }),
    )
  })

  it('writes markdown/html and publishes a fake PDF artifact', async () => {
    const filesSeen: Array<{ absolutePath: string; relativePath: string }> = []
    setWorkspaceService({
      ensureWorkspace: async (sessionId: number) => ({
        sessionId,
        rootPath: tempDir,
        inputPath: path.join(tempDir, 'input'),
        artifactsPath: path.join(tempDir, 'artifacts'),
        reposPath: path.join(tempDir, 'repos'),
        venvPath: path.join(tempDir, '.venv'),
        metaPath: path.join(tempDir, '.meta'),
        record: { id: 99 },
      }),
    } as any)
    await fs.mkdir(path.join(tempDir, 'artifacts'), { recursive: true })
    setArtifactService({
      publishDiscoveredFiles: async (params: any) => {
        filesSeen.push(...params.files)
        return params.files.map((file: any, index: number) => ({
          id: index + 1,
          fileName: path.basename(file.relativePath),
          mimeType: file.relativePath.endsWith('.pdf') ? 'application/pdf' : 'text/markdown',
          sizeBytes: 123,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          downloadUrl: `/api/artifacts/${index + 1}/download`,
        }))
      },
    } as any)

    const config: PdfExportHandlerConfig = {
      enabled: true,
      renderPdf: async (_markdown, outputPath) => {
        await fs.writeFile(outputPath, '%PDF-1.4 fake', 'utf8')
        return { sizeBytes: 14 }
      },
    }
    const handler = new ExportPdfToolHandler(config)
    const result = await handler.handle(
      { id: 'call_2', function: { name: 'export_pdf', arguments: '{}' } },
      { title: '深度研究', markdown: '# 报告\n\n正文', filename: 'research' },
      baseContext as any,
    )

    expect(filesSeen.some((file) => file.relativePath.endsWith('.pdf'))).toBe(true)
    expect(filesSeen.some((file) => file.relativePath.endsWith('.md'))).toBe(true)
    expect(filesSeen.some((file) => file.relativePath.endsWith('.html'))).toBe(true)
    expect(result.message.content).toContain('"pdf_generated":true')
    expect(baseContext.sendStreamEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'artifact' }),
    )
    const pdfPath = filesSeen.find((file) => file.relativePath.endsWith('.pdf'))!.absolutePath
    expect(await fs.readFile(pdfPath, 'utf8')).toContain('%PDF')
  })

  it('falls back to markdown/html artifacts when pdf rendering fails', async () => {
    const filesSeen: Array<{ absolutePath: string; relativePath: string }> = []
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    setWorkspaceService({
      ensureWorkspace: async (sessionId: number) => ({
        sessionId,
        rootPath: tempDir,
        inputPath: path.join(tempDir, 'input'),
        artifactsPath: path.join(tempDir, 'artifacts'),
        reposPath: path.join(tempDir, 'repos'),
        venvPath: path.join(tempDir, '.venv'),
        metaPath: path.join(tempDir, '.meta'),
        record: { id: 100 },
      }),
    } as any)
    await fs.mkdir(path.join(tempDir, 'artifacts'), { recursive: true })
    setArtifactService({
      publishDiscoveredFiles: async (params: any) => {
        filesSeen.push(...params.files)
        return params.files.map((file: any, index: number) => ({
          id: index + 1,
          fileName: path.basename(file.relativePath),
          mimeType: file.relativePath.endsWith('.html') ? 'text/html' : 'text/markdown',
          sizeBytes: 12,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          downloadUrl: `/api/artifacts/${index + 1}/download`,
        }))
      },
    } as any)

    try {
      const handler = new ExportPdfToolHandler({
        enabled: true,
        renderPdf: async () => {
          throw new Error('no chromium')
        },
      })
      const result = await handler.handle(
        { id: 'call_3', function: { name: 'export_pdf', arguments: '{}' } },
        { title: 'Fallback', markdown: '# Fallback' },
        baseContext as any,
      )

      expect(filesSeen.some((file) => file.relativePath.endsWith('.pdf'))).toBe(false)
      expect(filesSeen.some((file) => file.relativePath.endsWith('.html'))).toBe(true)
      expect(result.message.content).toContain('"pdf_generated":false')
    } finally {
      errorSpy.mockRestore()
    }
  })
})
