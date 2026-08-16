/**
 * export_pdf 工具处理器
 *
 * 将模型生成的 Markdown 报告写入会话 workspace，并用 Chromium 渲染为
 * 可下载 PDF artifact。Chromium 不可用时降级为 Markdown + HTML artifact，
 * 不让深度研究报告本身因 PDF 环境缺失而丢失。
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { workspaceService, type WorkspaceInfo } from '../../../services/workspace/workspace-service'
import { artifactService, type ArtifactDescriptor } from '../../../services/workspace/artifact-service'
import {
  buildReportHtml,
  renderMarkdownToHtml,
  renderMarkdownToPdfFile,
} from '../../../services/reports/pdf-report-service'
import { readRemoteImages } from '../../../utils/remote-image-reader'
import type {
  IToolHandler,
  PdfExportHandlerConfig,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
} from './types'

const DEFAULT_MAX_MARKDOWN_CHARS = 200_000
const DEFAULT_MAX_TITLE_CHARS = 200
const DEFAULT_MAX_FILENAME_CHARS = 80
const DEFAULT_MAX_REPORT_IMAGES = 6
const DEFAULT_MAX_IMAGE_CAPTION_CHARS = 200

const normalizeTimestamp = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

const normalizeTitle = (value: unknown): string => {
  const title = typeof value === 'string' ? value.trim() : ''
  return title.slice(0, DEFAULT_MAX_TITLE_CHARS) || 'Deep Research Report'
}

const normalizeFileStem = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : ''
  const stem = (raw || 'deep-research-report')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, DEFAULT_MAX_FILENAME_CHARS)
  return stem || 'deep-research-report'
}

interface ReportImageInput {
  url?: unknown
  caption?: unknown
}

interface NormalizedReportImage {
  url: string
  caption?: string
}

const normalizeReportImages = (value: unknown): NormalizedReportImage[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: NormalizedReportImage[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as ReportImageInput
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    const caption = typeof item.caption === 'string' ? item.caption.trim().slice(0, DEFAULT_MAX_IMAGE_CAPTION_CHARS) : ''
    result.push({ url, ...(caption ? { caption } : {}) })
    if (result.length >= DEFAULT_MAX_REPORT_IMAGES) break
  }
  return result
}

interface ArtifactEventPayload {
  id: number
  fileName: string
  mimeType: string
  sizeBytes: number
  expiresAt: string
  downloadUrl: string
}

export class ExportPdfToolHandler implements IToolHandler {
  readonly toolName = 'export_pdf'
  private readonly config: PdfExportHandlerConfig

  constructor(config: PdfExportHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'export_pdf',
        description:
          'Export a finished Markdown research report to a styled A4 PDF and publish the PDF as a downloadable chat artifact. Call this only after the report is complete and proofread.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Human-readable report title shown on the PDF cover header.',
            },
            markdown: {
              type: 'string',
              description: 'Complete report content in Markdown, including headings, citations and a sources section.',
            },
            filename: {
              type: 'string',
              description: 'Optional file stem without extension. Defaults to deep-research-report-<timestamp>.',
            },
            images: {
              type: 'array',
              description: 'Optional evidence images already filtered by the vision transcription proxy in this research. The backend only embeds images listed here, and the image URLs must match those returned by web_search/read_url. Do not invent URLs.',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string', description: 'The exact public image URL returned by web_search/read_url.' },
                  caption: { type: 'string', description: 'Optional figure caption shown below the image.' },
                },
                required: ['url'],
              },
            },
          },
          required: ['title', 'markdown'],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<ToolHandlerResult> {
    const callId = toolCall.id || randomUUID()
    const title = normalizeTitle(args.title)
    const markdown = typeof args.markdown === 'string' ? args.markdown.trim() : ''
    const maxMarkdownChars = this.config.maxMarkdownChars ?? DEFAULT_MAX_MARKDOWN_CHARS
    const requestedStem = normalizeFileStem(args.filename)
    const timestamp = normalizeTimestamp(new Date())
    const stem = requestedStem === 'deep-research-report'
      ? `${requestedStem}-${timestamp}`
      : `${requestedStem}`
    const fileNameBase = `${stem}-${timestamp}`
    const reportImages = normalizeReportImages(args.images)

    const buildErrorResult = (message: string): ToolHandlerResult => {
      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'error',
        error: message,
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: this.toolName,
          content: JSON.stringify({ error: message }),
        },
      }
    }

    if (!markdown) {
      return buildErrorResult('export_pdf 需要非空的 markdown 报告内容')
    }
    if (markdown.length > maxMarkdownChars) {
      return buildErrorResult(`报告过长（${markdown.length} 字符），上限为 ${maxMarkdownChars} 字符`)
    }
    if (!Number.isFinite(context.sessionId) || context.sessionId <= 0) {
      return buildErrorResult('export_pdf 需要有效的会话 ID')
    }

    context.sendToolEvent({
      id: callId,
      tool: this.toolName,
      stage: 'start',
      summary: `生成 PDF：${title}`,
      details: {
        title,
        markdownChars: markdown.length,
        fileNameBase,
        imageCount: reportImages.length,
      },
    })

    let workspace: WorkspaceInfo
    try {
      workspace = await workspaceService.ensureWorkspace(context.sessionId)
    } catch (error) {
      return buildErrorResult(error instanceof Error ? error.message : '创建 workspace 失败')
    }

    const imageSources: Record<string, string> = {}
    if (reportImages.length > 0) {
      const downloaded = await readRemoteImages(
        reportImages.map((image) => ({ url: image.url, alt: image.caption })),
        {
          maxCount: reportImages.length,
          timeoutMs: 15_000,
          limits: {
            maxCount: DEFAULT_MAX_REPORT_IMAGES,
            maxMb: 8,
            maxEdge: 8192,
            maxTotalMb: 24,
          },
        },
      )
      for (const image of downloaded) {
        imageSources[image.url] = `data:${image.mime};base64,${image.data}`
      }
      // 模型 Markdown 里通常使用原始 URL；若下载器返回了规范化 URL，也把原始 URL 指向同一份内嵌数据。
      for (const requested of reportImages) {
        if (!imageSources[requested.url]) {
          const matched = downloaded.find((image) => image.url === requested.url)
          if (matched) {
            imageSources[requested.url] = `data:${matched.mime};base64,${matched.data}`
          }
        }
      }
    }

    const markdownPath = path.resolve(workspace.artifactsPath, `${fileNameBase}.md`)
    const htmlPath = path.resolve(workspace.artifactsPath, `${fileNameBase}.html`)
    const pdfPath = path.resolve(workspace.artifactsPath, `${fileNameBase}.pdf`)
    const markdownRelative = `artifacts/${fileNameBase}.md`
    const htmlRelative = `artifacts/${fileNameBase}.html`
    const pdfRelative = `artifacts/${fileNameBase}.pdf`
    const renderMarkdown = this.config.renderMarkdown ?? renderMarkdownToHtml
    const buildHtml = this.config.buildHtml ?? buildReportHtml
    const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const html = buildHtml({
      title,
      markdownHtml: renderMarkdown(markdown, imageSources),
      generatedAt,
    })

    try {
      await fs.writeFile(markdownPath, markdown, 'utf8')
      await fs.writeFile(htmlPath, html, 'utf8')
    } catch (error) {
      return buildErrorResult(error instanceof Error ? error.message : '写入报告文件失败')
    }

    let pdfGenerated = false
    let pdfError: string | undefined
    try {
      const renderPdf = this.config.renderPdf ?? renderMarkdownToPdfFile
      const result = await renderPdf(markdown, pdfPath, {
        title,
        browserExecutablePath: this.config.browserExecutablePath,
        imageSources,
      })
      pdfGenerated = result.sizeBytes > 0
    } catch (error) {
      pdfError = error instanceof Error ? error.message : 'Chromium PDF 渲染失败'
      await fs.rm(pdfPath, { force: true }).catch(() => {})
      context.sendToolEvent({
        id: callId,
        tool: this.toolName,
        stage: 'start',
        summary: `PDF 渲染失败，已降级为 Markdown/HTML：${title}`,
        details: {
          title,
          pdfError,
        },
      })
    }

    const files: Array<{ absolutePath: string; relativePath: string }> = pdfGenerated
      ? [
          { absolutePath: pdfPath, relativePath: pdfRelative },
          { absolutePath: markdownPath, relativePath: markdownRelative },
          { absolutePath: htmlPath, relativePath: htmlRelative },
        ]
      : [
          { absolutePath: markdownPath, relativePath: markdownRelative },
          { absolutePath: htmlPath, relativePath: htmlRelative },
        ]

    let artifacts: ArtifactDescriptor[] = []
    try {
      artifacts = await artifactService.publishDiscoveredFiles({
        workspaceSessionId: workspace.record.id,
        sessionId: context.sessionId,
        workspaceRoot: workspace.rootPath,
        messageId: context.messageId ?? null,
        files,
      })
    } catch (error) {
      return buildErrorResult(error instanceof Error ? error.message : '发布报告 artifact 失败')
    }

    const artifactPayload: ArtifactEventPayload[] = artifacts.map((artifact) => ({
      id: artifact.id,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      expiresAt: artifact.expiresAt,
      downloadUrl: artifact.downloadUrl,
    }))

    const resultDetails: Record<string, unknown> = {
      title,
      fileNameBase,
      pdfGenerated,
      artifacts: artifactPayload,
    }
    if (pdfError) {
      resultDetails.pdfError = pdfError
    }

    context.sendToolEvent({
      id: callId,
      tool: this.toolName,
      stage: 'result',
      summary: pdfGenerated ? `PDF 已生成：${artifactPayload[0]?.fileName ?? fileNameBase}` : `报告已生成（PDF 降级）：${title}`,
      details: resultDetails,
    })

    if (context.sendStreamEvent && artifactPayload.length > 0) {
      context.sendStreamEvent({
        type: 'artifact',
        artifacts: artifactPayload,
      })
    }

    const note = pdfGenerated
      ? `PDF 报告已生成并发布为可下载附件：${artifactPayload.find((item) => item.fileName.endsWith('.pdf'))?.fileName ?? `${fileNameBase}.pdf`}`
      : `Chromium 不可用，已发布 Markdown/HTML 报告（PDF 生成失败：${pdfError || 'unknown'}）。`

    return {
      toolCallId: callId,
      toolName: this.toolName,
      message: {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: this.toolName,
        content: JSON.stringify({
          ok: true,
          title,
          pdf_generated: pdfGenerated,
          note,
          artifacts: artifactPayload,
        }),
      },
    }
  }
}
