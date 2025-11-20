import { StreamTraceService } from '../stream-trace-service'

jest.mock('@aichat/shared/latex-normalizer', () => ({
  analyzeLatexBlocks: jest.fn(() => ({
    matchedCount: 1,
    unmatchedCount: 0,
    segments: [
      { matched: true, reason: 'ok', trimmed: 'E=mc^2', preview: 'E=mc^2' },
    ],
  })),
}))

const mockCreate = jest.fn(async () => ({
  logSegments: jest.fn(),
}))

jest.mock('../../../../utils/latex-trace', () => ({
  LatexTraceRecorder: { create: (...args: any[]) => mockCreate(...args) },
}))

const buildRecorder = () => {
  const recorder = {
    getTraceId: jest.fn(() => 123),
    isEnabled: jest.fn(() => true),
    setMessageContext: jest.fn(),
  }
  return recorder as any
}

describe('StreamTraceService', () => {
  it('creates latex trace when content has segments', async () => {
    const recorder = buildRecorder()
    const service = new StreamTraceService()
    const result = await service.handleLatexTrace({
      traceRecorder: recorder as any,
      latexTraceRecorder: null,
      content: 'hello',
      assistantMessageId: 9,
      assistantClientMessageId: 'assist1',
      clientMessageId: 'client1',
    })
    expect(mockCreate).toHaveBeenCalled()
    expect(result.latexAuditSummary).toEqual({ matched: 1, unmatched: 0 })
    expect(recorder.setMessageContext).toHaveBeenCalledWith(9, 'assist1')
  })

  it('skips when trace id missing or disabled', async () => {
    const recorder = {
      getTraceId: jest.fn(() => null),
      isEnabled: jest.fn(() => false),
      setMessageContext: jest.fn(),
    }
    mockCreate.mockClear()
    const service = new StreamTraceService()
    const result = await service.handleLatexTrace({
      traceRecorder: recorder as any,
      latexTraceRecorder: null,
      content: 'text',
      assistantMessageId: null,
    })
    expect(result.latexTraceRecorder).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
