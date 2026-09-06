import { parseSystemSettingsPayload } from '@aichat/shared/settings-codec'
import { serializeSystemSettingsPatch } from '@aichat/shared'

describe('retired provider contracts', () => {
  it('does not expose retired settings from stored data', () => {
    const settings = parseSystemSettingsPayload({
      ollama_think: true,
      image_transcription_ollama_think: true,
    })
    expect(settings).not.toHaveProperty('ollamaThink')
    expect(settings).not.toHaveProperty('imageTranscriptionOllamaThink')
  })

  it('does not serialize retired settings from stale clients', () => {
    const stalePatch = { reasoningEnabled: true, ollamaThink: true, imageTranscriptionOllamaThink: true }
    expect(serializeSystemSettingsPatch(stalePatch))
      .toEqual({ reasoning_enabled: true })
  })
})
