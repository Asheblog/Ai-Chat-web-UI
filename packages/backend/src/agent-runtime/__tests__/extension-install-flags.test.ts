import {
  computeAgentToolFlags,
  detectExtensionSourceInMessage,
  isExtensionInstallToolEnabled,
} from '../agent-tool-config'

const baseInput = {
  sysMap: {} as Record<string, string>,
  requestedSkills: { builtin: [], enabled: [] },
  hasKnowledgeBases: false,
  webSearchConfig: { enabled: false, engines: [], engineOrder: [], apiKeys: {}, resultLimit: 4, domains: [] },
  pythonToolConfig: { enabled: false, timeoutMs: 1000, maxOutputChars: 1000, maxSourceChars: 1000 },
  workspaceToolConfig: { enabled: false, listMaxEntries: 10, readMaxChars: 1000, gitCloneTimeoutMs: 1000 },
  urlReaderConfig: { enabled: false },
} as any

describe('extension install activation', () => {
  it('stays off for ordinary messages', () => {
    const flags = computeAgentToolFlags(baseInput)
    expect(flags.extensionInstallActive).toBe(false)
    expect(flags.agentToolsActive).toBe(false)
  })

  it('activates on a detected repository link', () => {
    const flags = computeAgentToolFlags({ ...baseInput, extensionSourceDetected: true })
    expect(flags.extensionInstallActive).toBe(true)
    expect(flags.agentToolsActive).toBe(true)
  })

  it('respects the disable switch', () => {
    const flags = computeAgentToolFlags({
      ...baseInput,
      extensionSourceDetected: true,
      extensionInstallEnabled: false,
    })
    expect(flags.extensionInstallActive).toBe(false)
  })
})

describe('detectExtensionSourceInMessage', () => {
  it('detects github links', () => {
    expect(detectExtensionSourceInMessage('帮我装 https://github.com/acme/demo')).toBe(true)
    expect(detectExtensionSourceInMessage('https://raw.githubusercontent.com/a/b/main/SKILL.md')).toBe(true)
  })

  it('ignores ordinary text', () => {
    expect(detectExtensionSourceInMessage('你好，解释一下这个报错')).toBe(false)
    expect(detectExtensionSourceInMessage('https://example.com/acme/demo')).toBe(false)
  })
})

describe('isExtensionInstallToolEnabled', () => {
  it('defaults to enabled', () => {
    expect(isExtensionInstallToolEnabled({})).toBe(true)
  })

  it('honours the system setting', () => {
    expect(isExtensionInstallToolEnabled({ extension_install_tool_enable: 'false' })).toBe(false)
    expect(isExtensionInstallToolEnabled({ extension_install_tool_enable: 'true' })).toBe(true)
  })
})
