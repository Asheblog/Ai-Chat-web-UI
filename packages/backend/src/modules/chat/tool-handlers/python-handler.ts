/**
 * Python 代码执行工具处理器（workspace 沙箱版）
 */

import { randomUUID } from 'node:crypto'
import { truncateText } from '../../../utils/parsers'
import { workspacePythonRuntime } from '../../../services/workspace/workspace-python-runtime'
import { WorkspaceServiceError } from '../../../services/workspace/workspace-errors'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  PythonHandlerConfig,
} from './types'

export class PythonToolHandler implements IToolHandler {
  readonly toolName = 'python_runner'
  private config: PythonHandlerConfig

  constructor(config: PythonHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'python_runner',
        description:
          'Execute Python code inside the isolated workspace sandbox. Save downloadable files to /workspace/artifacts.',
        parameters: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description:
                'Python code to execute in sandbox. Use /workspace/artifacts for downloadable outputs.',
            },
            input: {
              type: 'string',
              description: 'Optional standard input passed to the Python process.',
            },
          },
          required: ['code'],
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
    const source = typeof args.code === 'string' ? args.code : ''
    const stdin = typeof args.input === 'string' ? args.input : undefined
    const callId = toolCall.id || randomUUID()
    const reasoningMetaBase = { kind: 'tool', tool: 'python_runner', callId }

    if (!source.trim()) {
      const error = '模型未提供 Python code'
      context.emitReasoning(error, { ...reasoningMetaBase, stage: 'error' })
      context.sendToolEvent({
        id: callId,
        tool: 'python_runner',
        stage: 'error',
        error,
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'python_runner',
          content: JSON.stringify({ error }),
        },
      }
    }

    const preview = truncateText(source.replace(/\s+/g, ' '), 180)
    const baseDetails: Record<string, unknown> = { code: source }
    if (stdin !== undefined) {
      baseDetails.input = stdin
    }

    context.emitReasoning('在会话 workspace 中执行 Python 代码', {
      ...reasoningMetaBase,
      stage: 'start',
      summary: preview,
    })
    context.sendToolEvent({
      id: callId,
      tool: 'python_runner',
      stage: 'start',
      summary: preview,
      details: baseDetails,
    })

    try {
      const result = await workspacePythonRuntime.runPythonSnippet({
        sessionId: context.sessionId,
        messageId: context.messageId ?? null,
        toolCallId: callId,
        code: source,
        input: stdin,
        timeoutMs: this.config.timeoutMs,
        maxOutputChars: this.config.maxOutputChars,
        maxSourceChars: this.config.maxSourceChars,
      })

      const resultPreview = truncateText(
        result.stdout.trim() ||
          (result.stderr ? `stderr: ${result.stderr.trim()}` : 'Python 运行完成'),
        220,
      )

      context.emitReasoning('Python 执行完成，准备综合结果。', {
        ...reasoningMetaBase,
        stage: 'result',
        summary: resultPreview,
      })

      const resultDetails: Record<string, unknown> = {
        ...baseDetails,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      }
      if (result.truncated) {
        resultDetails.truncated = true
      }
      if (Array.isArray(result.autoInstalledRequirements) && result.autoInstalledRequirements.length > 0) {
        resultDetails.autoInstalledRequirements = result.autoInstalledRequirements
      }
      if (Array.isArray(result.artifacts) && result.artifacts.length > 0) {
        resultDetails.artifacts = result.artifacts
      }

      context.sendToolEvent({
        id: callId,
        tool: 'python_runner',
        stage: 'result',
        summary: resultPreview,
        details: resultDetails,
      })

      if (context.sendStreamEvent && Array.isArray(result.artifacts) && result.artifacts.length > 0) {
        context.sendStreamEvent({
          type: 'artifact',
          artifacts: result.artifacts,
        })
      }

      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'python_runner',
          content: JSON.stringify({
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exitCode,
            duration_ms: result.durationMs,
            truncated: result.truncated || undefined,
            auto_installed_requirements:
              Array.isArray(result.autoInstalledRequirements) && result.autoInstalledRequirements.length > 0
                ? result.autoInstalledRequirements
                : undefined,
            artifacts:
              Array.isArray(result.artifacts) && result.artifacts.length > 0
                ? result.artifacts
                : undefined,
          }),
        },
      }
    } catch (pythonError: unknown) {
      const message = pythonError instanceof Error ? pythonError.message : 'Python 执行失败'
      const isRuntimeUnavailable =
        pythonError instanceof WorkspaceServiceError &&
        pythonError.code === 'WORKSPACE_DOCKER_UNAVAILABLE'
      context.emitReasoning(`Python 执行失败：${message}`, {
        ...reasoningMetaBase,
        stage: 'error',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'python_runner',
        stage: 'error',
        error: message,
        details: {
          ...baseDetails,
          code: pythonError instanceof WorkspaceServiceError ? pythonError.code : undefined,
          statusCode: pythonError instanceof WorkspaceServiceError ? pythonError.statusCode : undefined,
        },
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'python_runner',
          content: JSON.stringify({
            error: message,
            unavailable: isRuntimeUnavailable || undefined,
          }),
        },
      }
    }
  }
}
