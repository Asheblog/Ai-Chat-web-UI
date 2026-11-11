import { extractTitleFromProviderResponse } from '../title-summary-service'

describe('extractTitleFromProviderResponse', () => {
  it('extracts Gemini candidates text', () => {
    expect(
      extractTitleFromProviderResponse(
        {
          candidates: [
            {
              content: {
                parts: [{ text: 'Gemini ' }, { text: '标题' }],
              },
            },
          ],
        },
        'google_genai',
      ),
    ).toBe('Gemini 标题')
  })

  it('extracts OpenAI choices content and reasoning fallback', () => {
    expect(
      extractTitleFromProviderResponse(
        { choices: [{ message: { content: 'OpenAI 标题' } }] },
        'openai',
      ),
    ).toBe('OpenAI 标题')
    expect(
      extractTitleFromProviderResponse(
        { choices: [{ message: { content: '', reasoning_content: '推理标题' } }] },
        'anthropic',
      ),
    ).toBe('推理标题')
  })

  it('extracts Responses API output text', () => {
    expect(
      extractTitleFromProviderResponse(
        {
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Responses 标题' }],
            },
          ],
        },
        'openai_responses',
      ),
    ).toBe('Responses 标题')
  })
})
