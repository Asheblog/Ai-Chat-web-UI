import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// --- Hoisted mocks needed by vi.mock factories ---
const {
  mockUpdateSessionSkillBinding,
  mockListSkillCatalog,
  mockListSessionSkillOptions,
  mockRouterPush,
  mockToast,
  mockCreateSession,
  mockStreamMessage,
  mockUpdateSessionPrefs,
  chatStoreState,
} = vi.hoisted(() => {
  const state = {
    createSession: vi.fn() as any,
    streamMessage: vi.fn() as any,
    updateSessionPrefs: vi.fn() as any,
    currentSession: null as { id: number } | null,
  }
  return {
    mockUpdateSessionSkillBinding: vi.fn(),
    mockListSkillCatalog: vi.fn(),
    mockListSessionSkillOptions: vi.fn(),
    mockRouterPush: vi.fn(),
    mockToast: vi.fn(),
    mockCreateSession: state.createSession,
    mockStreamMessage: state.streamMessage,
    mockUpdateSessionPrefs: state.updateSessionPrefs,
    chatStoreState: state,
  }
})

vi.mock('@/features/skills/api', () => ({
  listSkillCatalog: (...args: any[]) => mockListSkillCatalog(...args),
  listSessionSkillOptions: (...args: any[]) => mockListSessionSkillOptions(...args),
  updateSessionSkillBinding: (...args: any[]) => mockUpdateSessionSkillBinding(...args),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/store/chat-store', () => ({
  useChatStore: Object.assign(
    (selector?: any) => {
      if (typeof selector === 'function') {
        return selector(chatStoreState)
      }
      return chatStoreState
    },
    { getState: () => chatStoreState },
  ),
}))

// --- Mock settings store ---
vi.mock('@/store/settings-store', () => ({
  useSettingsStore: () => ({
    systemSettings: {
      reasoningEnabled: true,
      openaiReasoningEffort: 'unset',
      chatSystemPrompt: '',
      webSearchAgentEnable: false,
      webSearchHasApiKey: false,
      pythonToolEnable: true,
      brandText: 'AIChat',
    },
    publicBrandText: 'AIChat',
  }),
}))

// --- Mock models store ---
const testModel = {
  id: 'model-1',
  connectionId: 1,
  rawId: 'gpt-4',
  name: 'GPT-4',
  modelId: 'model-1',
  capabilities: { vision: true },
  connection: { id: 1, name: 'test' },
}

vi.mock('@/store/models-store', () => ({
  useModelsStore: () => ({
    models: [testModel],
    fetchAll: vi.fn().mockResolvedValue(undefined),
  }),
}))

// --- Mock auth store ---
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector?: any) => {
    if (typeof selector === 'function') {
      return selector({
        actorState: 'authenticated',
        quota: { unlimited: true },
        actor: { type: 'user', id: 1, username: 'test' },
      })
    }
    return {
      actorState: 'authenticated',
      quota: { unlimited: true },
      actor: { type: 'user', id: 1, username: 'test' },
    }
  },
}))

// --- Mock model preference store ---
vi.mock('@/store/model-preference-store', () => ({
  useModelPreferenceStore: () => ({ preferred: { modelId: 'model-1' } }),
  persistPreferredModel: vi.fn().mockResolvedValue(undefined),
  findPreferredModel: () => testModel,
  modelKeyFor: (m: any) => m.modelId || m.id,
}))

// --- Mock web search preference store ---
vi.mock('@/store/web-search-preference-store', () => ({
  useWebSearchPreferenceStore: () => ({ lastSelection: null, setLastSelection: vi.fn() }),
}))

// --- Mock python tool preference store ---
vi.mock('@/store/python-tool-preference-store', () => ({
  usePythonToolPreferenceStore: () => ({ lastSelection: null, setLastSelection: vi.fn() }),
}))

// --- Mock advanced request ---
vi.mock('@/features/chat/composer', () => ({
  useAdvancedRequest: () => ({
    customBodyInput: '',
    setCustomBodyInput: vi.fn(),
    customBodyError: null,
    setCustomBodyError: vi.fn(),
    customHeaders: [],
    addCustomHeader: () => ({ ok: true }),
    updateCustomHeader: vi.fn(),
    removeCustomHeader: vi.fn(),
    canAddHeader: true,
    buildRequestPayload: () => ({ ok: true }),
  }),
  useImageAttachments: () => ({
    selectedImages: [],
    setSelectedImages: vi.fn(),
    removeImage: vi.fn(),
    validateImage: vi.fn().mockResolvedValue({ ok: false }),
    handlePaste: vi.fn(),
  }),
  useComposerFeatureFlags: () => ({}),
}))

// --- Mock knowledge base ---
vi.mock('@/hooks/use-knowledge-base', () => ({
  useKnowledgeBase: () => ({
    availableKbs: [],
    selectedKbIds: [],
    isEnabled: false,
    hasPermission: false,
    isLoading: false,
    error: null,
    toggleKb: vi.fn(),
    setSelectedKbIds: vi.fn(),
    selectAll: vi.fn(),
    clearAll: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// Now import the viewModel
import { useWelcomeScreenViewModel } from '@/features/chat/welcome/useWelcomeScreenViewModel'

describe('useWelcomeScreenViewModel — skill binding in handleCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks() // also clear global fetch
    mockCreateSession.mockReset()
    mockStreamMessage.mockReset()
    mockUpdateSessionSkillBinding.mockReset()
    mockUpdateSessionPrefs.mockReset()
    mockRouterPush.mockReset()
    mockToast.mockReset()
    mockListSkillCatalog.mockReset()

    mockCreateSession.mockResolvedValue({ id: 999 })
    mockStreamMessage.mockResolvedValue(undefined)
    mockUpdateSessionSkillBinding.mockResolvedValue({ success: true })
    mockUpdateSessionPrefs.mockResolvedValue(undefined)
    chatStoreState.currentSession = { id: 999 }

    // Setup catalog with a user_private active skill so useSkillsSelection draft mode works
    mockListSkillCatalog.mockResolvedValue({
      success: true,
      data: [
        {
          id: 10,
          slug: 'test-skill',
          displayName: 'Test Skill',
          description: 'A test',
          visibility: 'user_private',
          status: 'active',
          defaultVersion: { id: 5, version: '1.0.0', status: 'active' },
          sourceKey: 'github',
          licenseName: 'MIT',
        },
      ],
    })
    mockListSessionSkillOptions.mockResolvedValue({
      success: true,
      data: { items: [] },
    })
  })

  it('handleCreate binds enabled skills to session and includes them in streamMessage options.skills.enabled', async () => {
    const { result } = renderHook(() => useWelcomeScreenViewModel())

    // Wait for useSkillsSelection draft mode to load catalog
    await waitFor(() => {
      expect(result.current.form.advancedOptions.skillOptions.length).toBeGreaterThan(0)
    })

    const initialSkills = result.current.form.advancedOptions.skillOptions
    expect(initialSkills.length).toBeGreaterThan(0)

    // Toggle the skill on
    await act(async () => {
      result.current.form.advancedOptions.onToggleSkillOption(initialSkills[0].skillId, true)
    })

    // Set a query so streamMessage will be called
    await act(async () => {
      result.current.form.onTextareaChange('hello world')
    })

    // Call handleCreate (onSubmit)
    await act(async () => {
      await result.current.form.onSubmit()
    })

    // Verify session was created
    expect(mockCreateSession).toHaveBeenCalled()

    // Verify updateSessionSkillBinding was called for enabled skill
    const enabledSkills = result.current.form.advancedOptions.skillOptions.filter((s: any) => s.enabled)
    expect(enabledSkills.length).toBeGreaterThan(0)
    expect(mockUpdateSessionSkillBinding).toHaveBeenCalledTimes(enabledSkills.length)
    expect(mockUpdateSessionSkillBinding).toHaveBeenCalledWith(999, {
      skillId: initialSkills[0].skillId,
      versionId: initialSkills[0].versionId,
      enabled: true,
    })

    // Verify streamMessage includes skills.enabled
    expect(mockStreamMessage).toHaveBeenCalled()
    const streamCall = mockStreamMessage.mock.calls[0]
    const options = streamCall[3]
    expect(options).toBeDefined()
    expect(options.skills).toBeDefined()
    expect(options.skills.enabled).toBeDefined()
    expect(options.skills.enabled.length).toBeGreaterThan(0)
    expect(options.skills.enabled[0]).toEqual({
      skillId: initialSkills[0].skillId,
      versionId: initialSkills[0].versionId,
    })
  })
})
