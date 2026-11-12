import { createToolHandlerRegistry } from '../registry'

const service = { installFromSource: jest.fn() } as any

describe('tool registry · install_extension', () => {
  it('registers the tool when enabled', () => {
    const registry = createToolHandlerRegistry({ extensionInstall: { enabled: true, service } })
    const names = registry.getToolDefinitions().map((item) => item.function.name)
    expect(names).toContain('install_extension')
    expect(registry.getAllowedToolNames().has('install_extension')).toBe(true)
    expect(registry.hasHandler('install_extension')).toBe(true)
  })

  it('omits the tool when disabled', () => {
    const registry = createToolHandlerRegistry({ extensionInstall: { enabled: false, service } })
    expect(registry.getToolDefinitions().map((item) => item.function.name)).not.toContain('install_extension')
    expect(registry.hasHandler('install_extension')).toBe(false)
  })

  it('omits the tool when no config is passed', () => {
    const registry = createToolHandlerRegistry({})
    expect(registry.hasHandler('install_extension')).toBe(false)
  })
})
