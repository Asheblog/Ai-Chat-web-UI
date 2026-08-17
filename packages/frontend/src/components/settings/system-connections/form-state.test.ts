import { describe, expect, test } from "vitest"
import type { SystemConnectionGroup } from "@/services/system-connections"
import { getProviderTemplate } from "./provider-templates"
import {
  buildPayload,
  createFormFromGroup,
  createFormFromTemplate,
  DEFAULT_FORM,
  validateBasicFields,
  validateForm,
} from "./form-state"
import { createEmptyConnectionCaps } from "./constants"

const makeGroup = (overrides: Partial<SystemConnectionGroup> = {}): SystemConnectionGroup => ({
  id: 1,
  displayName: "主力 OpenAI",
  connectionIds: [1],
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  authType: "bearer",
  tags: [{ name: "prod" }],
  connectionType: "external",
  defaultCapabilities: {},
  apiKeys: [
    {
      id: 1,
      apiKeyLabel: "Key 1",
      apiKeyMasked: "sk-***",
      hasStoredApiKey: true,
      modelIds: ["gpt-4o"],
      enable: true,
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

describe("form-state displayName", () => {
  test("DEFAULT_FORM 含空 displayName", () => {
    expect(DEFAULT_FORM.displayName).toBe("")
  })

  test("createFormFromGroup 读入 displayName", () => {
    const form = createFormFromGroup(makeGroup({ displayName: "办公网关" }))
    expect(form.displayName).toBe("办公网关")
  })

  test("createFormFromTemplate 预填 displayName 为模板 label", () => {
    const template = getProviderTemplate("ollama")!
    const form = createFormFromTemplate(template)
    expect(form.displayName).toBe("Ollama")
    expect(form.baseUrl).toBe("http://localhost:11434")
  })

  test("buildPayload 发送 trim 后的 displayName", () => {
    const form = {
      ...DEFAULT_FORM,
      displayName: "  生产 OpenAI  ",
      baseUrl: "https://api.openai.com/v1",
      keys: [
        {
          clientId: "k1",
          apiKeyLabel: "Key 1",
          apiKey: "sk-test",
          apiKeyMasked: "",
          hasStoredApiKey: false,
          modelIds: "",
          enable: true,
        },
      ],
    }
    const payload = buildPayload(form, createEmptyConnectionCaps())
    expect(payload.displayName).toBe("生产 OpenAI")
  })

  test("validateForm 要求 displayName", () => {
    const form = {
      ...DEFAULT_FORM,
      displayName: "   ",
      baseUrl: "https://api.openai.com/v1",
      keys: [
        {
          clientId: "k1",
          apiKeyLabel: "Key 1",
          apiKey: "sk-test",
          apiKeyMasked: "",
          hasStoredApiKey: false,
          modelIds: "",
          enable: true,
        },
      ],
    }
    expect(validateForm(form, null)).toBe("请填写显示名称")
  })

  test("validateForm 有 displayName 时通过基础校验", () => {
    const form = {
      ...DEFAULT_FORM,
      displayName: "测试连接",
      baseUrl: "https://api.openai.com/v1",
      keys: [
        {
          clientId: "k1",
          apiKeyLabel: "Key 1",
          apiKey: "sk-test",
          apiKeyMasked: "",
          hasStoredApiKey: false,
          modelIds: "",
          enable: true,
        },
      ],
    }
    expect(validateForm(form, null)).toBeNull()
  })

  test("validateBasicFields 在 bearer 缺 Key 时拦截", () => {
    const form = {
      ...DEFAULT_FORM,
      displayName: "测试连接",
      baseUrl: "https://api.openai.com/v1",
      keys: [
        {
          clientId: "k1",
          apiKeyLabel: "Key 1",
          apiKey: "",
          apiKeyMasked: "",
          hasStoredApiKey: false,
          modelIds: "",
          enable: true,
        },
      ],
    }
    expect(validateBasicFields(form)).toBe("Key 1 还没有可用的 API Key")
  })
})
