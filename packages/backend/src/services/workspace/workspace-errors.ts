export class WorkspaceServiceError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    statusCode = 400,
    code = 'WORKSPACE_ERROR',
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WorkspaceServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}
