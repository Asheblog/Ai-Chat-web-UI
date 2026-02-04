/**
 * Agent 工具配置构建器
 * 从系统设置和环境变量构建工具配置
 */

import {
  parseBooleanSetting,
  parseDomainListSetting,
  parseNumberSetting,
  parseEnumSetting,
  clampNumber,
} from '../../utils/parsers';

/**
 * Web 搜索配置
 */
export interface AgentWebSearchConfig {
  enabled: boolean;
  engine: string;
  apiKey?: string;
  resultLimit: number;
  domains: string[];
  endpoint?: string;
  scope?: string;
  includeSummary?: boolean;
  includeRawContent?: boolean;
}

/**
 * Python 工具配置
 */
export interface AgentPythonToolConfig {
  enabled: boolean;
  command: string;
  args: string[];
  timeoutMs: number;
  maxOutputChars: number;
  maxSourceChars: number;
}

/**
 * URL Reader 配置
 */
export interface AgentUrlReaderConfig {
  enabled: boolean;
  timeout: number;
  maxContentLength: number;
}

const WEB_SEARCH_SCOPES = ['webpage', 'document', 'paper', 'image', 'video', 'podcast'] as const;

/**
 * 构建 Web 搜索配置
 */
export const buildAgentWebSearchConfig = (
  sysMap: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): AgentWebSearchConfig => {
  const enabled = parseBooleanSetting(
    sysMap.web_search_agent_enable ?? env.WEB_SEARCH_AGENT_ENABLE,
    false
  );

  const engine = (
    sysMap.web_search_default_engine ||
    env.WEB_SEARCH_DEFAULT_ENGINE ||
    'tavily'
  ).toLowerCase();

  const engineUpper = engine.toUpperCase();
  const apiKey =
    sysMap[`web_search_api_key_${engine}`] ||
    env[`WEB_SEARCH_API_KEY_${engineUpper}`] ||
    '';

  const resultLimit = clampNumber(
    parseNumberSetting(
      sysMap.web_search_result_limit ?? env.WEB_SEARCH_RESULT_LIMIT,
      { fallback: 4 }
    ),
    1,
    10
  );

  const sysDomains = parseDomainListSetting(sysMap.web_search_domain_filter);
  const envDomains = parseDomainListSetting(env.WEB_SEARCH_DOMAIN_FILTER);
  const domains = sysDomains.length > 0 ? sysDomains : envDomains;

  const endpoint = sysMap.web_search_endpoint || env.WEB_SEARCH_ENDPOINT;

  const scopeRaw = (sysMap.web_search_scope || env.WEB_SEARCH_SCOPE || '').trim().toLowerCase();
  const scope = WEB_SEARCH_SCOPES.includes(scopeRaw as typeof WEB_SEARCH_SCOPES[number])
    ? scopeRaw
    : undefined;

  const includeSummary = parseBooleanSetting(
    sysMap.web_search_include_summary ?? env.WEB_SEARCH_INCLUDE_SUMMARY,
    false
  );

  const includeRawContent = parseBooleanSetting(
    sysMap.web_search_include_raw ?? env.WEB_SEARCH_INCLUDE_RAW,
    false
  );

  return {
    enabled,
    engine,
    apiKey,
    resultLimit,
    domains,
    endpoint,
    scope,
    includeSummary,
    includeRawContent,
  };
};

/**
 * 构建 Python 工具配置
 */
export const buildAgentPythonToolConfig = (
  sysMap: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): AgentPythonToolConfig => {
  const enabled = parseBooleanSetting(
    sysMap.python_tool_enable ?? env.PYTHON_TOOL_ENABLE,
    false
  );

  const command =
    (sysMap.python_tool_command || env.PYTHON_TOOL_COMMAND || 'python3').trim() || 'python3';

  const argsRaw = sysMap.python_tool_args || env.PYTHON_TOOL_ARGS;
  const args = parseDomainListSetting(argsRaw)?.map((arg) => arg.replace(/\s+$/g, '')) || [];

  const getConfigValue = (sysValue: string | undefined, envKey: string): string | undefined => {
    return sysValue ?? env[envKey];
  };

  const timeoutMs = clampNumber(
    parseNumberSetting(
      getConfigValue(sysMap.python_tool_timeout_ms, 'PYTHON_TOOL_TIMEOUT_MS'),
      { fallback: 8000 }
    ),
    1000,
    60000
  );

  const maxOutputChars = clampNumber(
    parseNumberSetting(
      getConfigValue(sysMap.python_tool_max_output_chars, 'PYTHON_TOOL_MAX_OUTPUT_CHARS'),
      { fallback: 4000 }
    ),
    256,
    20000
  );

  const maxSourceChars = clampNumber(
    parseNumberSetting(
      getConfigValue(sysMap.python_tool_max_source_chars, 'PYTHON_TOOL_MAX_SOURCE_CHARS'),
      { fallback: 4000 }
    ),
    256,
    20000
  );

  return {
    enabled,
    command,
    args,
    timeoutMs,
    maxOutputChars,
    maxSourceChars,
  };
};

/**
 * 构建 URL Reader 配置
 */
export const buildAgentUrlReaderConfig = (
  sysMap: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): AgentUrlReaderConfig => {
  const enabled = parseBooleanSetting(
    sysMap.url_reader_enable ?? env.URL_READER_ENABLE,
    false
  );

  const timeout = clampNumber(
    parseNumberSetting(
      sysMap.url_reader_timeout ?? env.URL_READER_TIMEOUT,
      { fallback: 30000 }
    ),
    5000,
    120000
  );

  const maxContentLength = clampNumber(
    parseNumberSetting(
      sysMap.url_reader_max_content_length ?? env.URL_READER_MAX_CONTENT_LENGTH,
      { fallback: 100000 }
    ),
    10000,
    500000
  );

  return {
    enabled,
    timeout,
    maxContentLength,
  };
};
