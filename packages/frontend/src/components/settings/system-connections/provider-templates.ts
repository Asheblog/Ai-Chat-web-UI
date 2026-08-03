import {
  Bot,
  BrainCircuit,
  Cloud,
  Layers,
  MessagesSquare,
  Server,
  type LucideIcon,
} from "lucide-react"

export type ProviderTemplateKey =
  | "openai"
  | "openai_responses"
  | "azure_openai"
  | "ollama"
  | "google_genai"
  | "openai_interleave"

export type ProviderTemplate = {
  provider: ProviderTemplateKey
  /** 显示名（对齐 providerLabel：Azure / Google / Ollama / OpenAI Responses / OpenAI（交错思考）） */
  label: string
  /** 白话描述（一句话说清用途） */
  description: string
  icon: LucideIcon
  /** 默认端点 */
  baseUrl: string
  authType: "bearer" | "none"
  /** 仅 azure_openai */
  azureApiVersion?: string
  /** 端点提示（复用 HelperText 语义） */
  helperText?: string
}

/**
 * 6 个供应商快速接入模板。默认值沿用 baseUrlPlaceholder / HelperText / EditorParts 语义，
 * 配置 Sheet 打开时用 createFormFromTemplate 预填表单。
 */
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    provider: "openai",
    label: "OpenAI",
    description: "官方 OpenAI 端点，或 NewAPI 等 OpenAI 兼容网关的通用接入",
    icon: Bot,
    baseUrl: "https://api.openai.com/v1",
    authType: "bearer",
    helperText: "允许完整 Base URL，兼容网关（如 NewAPI）建议填写到版本层。",
  },
  {
    provider: "openai_responses",
    label: "OpenAI Responses",
    description: "面向 Responses API 的官方 OpenAI 端点",
    icon: MessagesSquare,
    baseUrl: "https://api.openai.com/v1",
    authType: "bearer",
  },
  {
    provider: "azure_openai",
    label: "Azure",
    description: "Azure OpenAI 服务，需配置资源名与 API 版本",
    icon: Cloud,
    baseUrl: "https://<资源名>.openai.azure.com/",
    authType: "bearer",
    azureApiVersion: "2024-02-15-preview",
  },
  {
    provider: "ollama",
    label: "Ollama",
    description: "本地 Ollama 服务，免 API Key 直连",
    icon: Server,
    baseUrl: "http://localhost:11434",
    authType: "none",
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
    provider: "openai_interleave",
    label: "OpenAI（交错思考）",
    description: "支持 Thinking Mode 的第三方 OpenAI 兼容端点（如 DeepSeek）",
    icon: Layers,
    baseUrl: "https://api.deepseek.com/v1",
    authType: "bearer",
    helperText: "适用于 DeepSeek、SiliconFlow 等支持 Thinking Mode 的 OpenAI 兼容 API。",
  },
]

export function getProviderTemplate(provider: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((template) => template.provider === provider)
}
