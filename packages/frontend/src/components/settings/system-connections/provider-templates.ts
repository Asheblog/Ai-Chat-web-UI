import {
  Bot,
  BrainCircuit,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react"

export type ProviderTemplateKey =
  | "openai"
  | "openai_responses"
  | "anthropic"
  | "google_genai"

export type ProviderProtocolOption = {
  /** 落库的 provider 值 */
  provider: "openai" | "openai_responses"
  /** 协议人读名称 */
  label: string
  /** 协议落库后表单默认显示名 */
  formLabel: string
  /** 卡片内协议说明 */
  hint: string
}

export type ProviderTemplate = {
  provider: ProviderTemplateKey
  /** 显示名（对齐 providerLabel） */
  label: string
  /** 白话描述（一句话说清用途） */
  description: string
  icon: LucideIcon
  /** 默认端点 */
  baseUrl: string
  /** 快速接入模板默认使用 bearer 认证。 */
  authType: "bearer"
  /** 同一张卡内可切换的协议（目前仅 OpenAI） */
  protocols?: ProviderProtocolOption[]
}

const OPENAI_PROTOCOLS: ProviderProtocolOption[] = [
  {
    provider: "openai",
    label: "Chat Completions",
    formLabel: "OpenAI",
    hint: "兼容面最广，支持 DeepSeek / SiliconFlow 等兼容网关的 Thinking 方言。",
  },
  {
    provider: "openai_responses",
    label: "Responses",
    formLabel: "OpenAI Responses",
    hint: "新版 /responses 协议，原生 reasoning 与函数工具。",
  },
]

/**
 * 3 张供应商快速接入卡：OpenAI（Chat Completions / Responses 双协议）、
 * Google（Generative Language API）、Anthropic（Messages API）。
 * 配置 Sheet 打开时用 createFormFromTemplate 预填表单。
 */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    provider: "openai",
    label: "OpenAI",
    description: "官方 OpenAI 端点，或 NewAPI 等兼容网关；按需选择 Chat Completions 或 Responses 协议",
    icon: Bot,
    baseUrl: "https://api.openai.com/v1",
    authType: "bearer",
    protocols: OPENAI_PROTOCOLS,
  },
  {
    provider: "google_genai",
    label: "Google",
    description: "Google Gemini 官方端点（Generative Language API）",
    icon: BrainCircuit,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    authType: "bearer",
  },
  {
    provider: "anthropic",
    label: "Anthropic",
    description: "Claude 官方端点，使用 Anthropic Messages API（/v1/messages）",
    icon: MessagesSquare,
    baseUrl: "https://api.anthropic.com/v1",
    authType: "bearer",
  },
]

export function getProviderTemplate(provider: string): ProviderTemplate | undefined {
  const template = PROVIDER_TEMPLATES.find(
    (item) =>
      item.provider === provider ||
      item.protocols?.some((protocol) => protocol.provider === provider),
  )
  if (!template) return undefined
  if (template.provider === provider) return template
  const protocol = template.protocols?.find((item) => item.provider === provider)
  if (!protocol) return template
  return {
    ...template,
    provider: protocol.provider,
    label: protocol.formLabel,
  }
}

export function getProviderCountProviders(template: ProviderTemplate): ProviderTemplateKey[] {
  return template.protocols?.map((protocol) => protocol.provider) ?? [template.provider]
}

export function getProviderProtocolHint(
  template: ProviderTemplate,
  provider: string,
): string | undefined {
  return template.protocols?.find((protocol) => protocol.provider === provider)?.hint
}