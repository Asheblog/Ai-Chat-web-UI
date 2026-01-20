import type { ToolDefinition } from './tool-handlers/types'

export type ToolProviderAdapter = (toolDefinitions: ToolDefinition[]) => Record<string, unknown>

type GeminiObjectSchemaType =
  | 'TYPE_UNSPECIFIED'
  | 'STRING'
  | 'NUMBER'
  | 'INTEGER'
  | 'BOOLEAN'
  | 'ARRAY'
  | 'OBJECT'

type GeminiObjectSchema = {
  type: GeminiObjectSchemaType
  title?: string
  description?: string
  nullable?: boolean
  enum?: string[]
  maxItems?: string
  minItems?: string
  properties?: Record<string, GeminiObjectSchema>
  required?: string[]
  anyOf?: GeminiObjectSchema[]
  items?: GeminiObjectSchema
  minimum?: number
  maximum?: number
}

type GeminiFunctionDeclaration = {
  name: string
  description?: string
  parameters?: GeminiObjectSchema
}

const jsonSchemaTypeToGeminiType = (value: string): GeminiObjectSchemaType => {
  switch (value.toLowerCase()) {
    case 'string':
      return 'STRING'
    case 'object':
      return 'OBJECT'
    case 'number':
      return 'NUMBER'
    case 'integer':
      return 'INTEGER'
    case 'array':
      return 'ARRAY'
    case 'boolean':
      return 'BOOLEAN'
    default:
      return 'TYPE_UNSPECIFIED'
  }
}

const convertJsonSchemaToGeminiSchema = (jsonSchema: any): GeminiObjectSchema => {
  const jsonSchemaType = jsonSchema?.type
  if (!jsonSchemaType || typeof jsonSchemaType !== 'string') {
    throw new Error('Invalid JSON schema type for Gemini tool definition')
  }
  const geminiSchema: GeminiObjectSchema = {
    type: jsonSchemaTypeToGeminiType(jsonSchemaType),
  }

  if (jsonSchema.title) geminiSchema.title = jsonSchema.title
  if (jsonSchema.description) geminiSchema.description = jsonSchema.description

  if (jsonSchemaType === 'null' || jsonSchema.nullable) {
    geminiSchema.nullable = true
  }

  if (Array.isArray(jsonSchema.enum)) {
    geminiSchema.enum = jsonSchema.enum.map(String)
  }

  if (jsonSchemaType === 'array') {
    if (typeof jsonSchema.maxItems !== 'undefined') {
      geminiSchema.maxItems = String(jsonSchema.maxItems)
    }
    if (typeof jsonSchema.minItems !== 'undefined') {
      geminiSchema.minItems = String(jsonSchema.minItems)
    }
    if (jsonSchema.items) {
      geminiSchema.items = convertJsonSchemaToGeminiSchema(jsonSchema.items)
    }
  }

  if (typeof jsonSchema.minimum !== 'undefined') {
    geminiSchema.minimum = Number(jsonSchema.minimum)
  }
  if (typeof jsonSchema.maximum !== 'undefined') {
    geminiSchema.maximum = Number(jsonSchema.maximum)
  }

  if (jsonSchema.properties && typeof jsonSchema.properties === 'object') {
    geminiSchema.properties = {}
    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      geminiSchema.properties[key] = convertJsonSchemaToGeminiSchema(value)
    }
  }

  if (Array.isArray(jsonSchema.required)) {
    geminiSchema.required = jsonSchema.required
  }

  if (Array.isArray(jsonSchema.anyOf)) {
    geminiSchema.anyOf = jsonSchema.anyOf.map(convertJsonSchemaToGeminiSchema)
  }

  return geminiSchema
}

const convertOpenAIToolToGeminiFunction = (tool: ToolDefinition): GeminiFunctionDeclaration => {
  const fn = tool?.function
  if (!fn?.name) {
    throw new Error('Function name required for Gemini tool definition')
  }

  const declaration: GeminiFunctionDeclaration = {
    name: fn.name,
    description: fn.description || '',
  }

  if (fn.parameters && typeof fn.parameters === 'object') {
    const params = fn.parameters as any
    if (params.type === 'object' && JSON.stringify(params.properties ?? {}) === '{}') {
      return declaration
    }
    declaration.parameters = convertJsonSchemaToGeminiSchema(params)
  }

  return declaration
}

const openaiAdapter: ToolProviderAdapter = (toolDefinitions) => ({ tools: toolDefinitions })

const googleGenaiAdapter: ToolProviderAdapter = (toolDefinitions) => {
  const declarations: GeminiFunctionDeclaration[] = []
  for (const tool of toolDefinitions) {
    try {
      declarations.push(convertOpenAIToolToGeminiFunction(tool))
    } catch {
      continue
    }
  }
  if (declarations.length === 0) return {}
  return { tools: [{ functionDeclarations: declarations }] }
}

const PROVIDER_ADAPTERS: Record<string, ToolProviderAdapter> = {
  openai: openaiAdapter,
  openai_responses: openaiAdapter,
  azure_openai: openaiAdapter,
  google_genai: googleGenaiAdapter,
}

export function resolveToolProviderAdapter(provider?: string): ToolProviderAdapter {
  if (!provider) return openaiAdapter
  return PROVIDER_ADAPTERS[provider] ?? openaiAdapter
}
