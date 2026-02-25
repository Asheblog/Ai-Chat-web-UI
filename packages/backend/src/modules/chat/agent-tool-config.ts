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
  timeoutMs: number;
  maxOutputChars: number;
  maxSourceChars: number;
}

/**
 * URL Reader 配置
 */
export interface AgentUrlReaderConfig {
  timeout: number;
  maxContentLength: number;
}

/**
 * Workspace 工具配置
 */
export interface AgentWorkspaceToolConfig {
  enabled: boolean;
  listMaxEntries: number;
  readMaxChars: number;
  gitCloneTimeoutMs: number;
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
  _sysMap: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env
): AgentPythonToolConfig => {
  // BREAKING: python_tool_* 旧配置不再作为聊天侧执行控制项；
  // Python 执行统一走 workspace 沙箱。
  const enabled = true;

  const timeoutMs = clampNumber(
    parseNumberSetting(
      env.WORKSPACE_RUN_TIMEOUT_MS,
      { fallback: 120000 }
    ),
    1000,
    10 * 60 * 1000
  );

  const maxOutputChars = clampNumber(
    parseNumberSetting(
      env.WORKSPACE_READ_MAX_CHARS,
      { fallback: 120000 }
    ),
    256,
    2_000_000
  );

  const maxSourceChars = clampNumber(
    parseNumberSetting(
      env.WORKSPACE_READ_MAX_CHARS,
      { fallback: 120000 }
    ),
    256,
    2_000_000
  );

  return {
    enabled,
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
    timeout,
    maxContentLength,
  };
};

/**
 * 构建 Workspace 工具配置
 */
export const buildAgentWorkspaceToolConfig = (
  sysMap: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): AgentWorkspaceToolConfig => {
  const enabled = parseBooleanSetting(
    sysMap.workspace_tool_enable ?? env.WORKSPACE_TOOL_ENABLE,
    true,
  );

  const listMaxEntries = clampNumber(
    parseNumberSetting(
      env.WORKSPACE_LIST_MAX_ENTRIES,
      { fallback: 500 },
    ),
    10,
    5000,
  );

  const readMaxChars = clampNumber(
    parseNumberSetting(
      env.WORKSPACE_READ_MAX_CHARS,
      { fallback: 120000 },
    ),
    1024,
    2_000_000,
  );

  const gitCloneTimeoutMs = clampNumber(
    parseNumberSetting(
      env.WORKSPACE_GIT_CLONE_TIMEOUT_MS,
      { fallback: 120000 },
    ),
    5000,
    10 * 60_000,
  );

  return {
    enabled,
    listMaxEntries,
    readMaxChars,
    gitCloneTimeoutMs,
  };
};
