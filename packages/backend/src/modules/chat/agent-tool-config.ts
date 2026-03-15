/**
 * Agent 工具配置构建器
 * 从系统设置和环境变量构建工具配置
 */

import {
  parseBooleanSetting,
  parseDomainListSetting,
  parseNumberSetting,
  clampNumber,
} from '../../utils/parsers';

/**
 * Web 搜索配置
 */
export type AgentWebSearchEngine = 'tavily' | 'brave' | 'metaso'
export type AgentWebSearchMergeStrategy = 'hybrid_score_v1'
export type AgentWebSearchBilingualMode = 'off' | 'conditional' | 'always'
export type AgentWebSearchConflictEscalation = 'off' | 'auto'

export interface AgentWebSearchLocaleRouting {
  zh?: AgentWebSearchEngine[]
  en?: AgentWebSearchEngine[]
  unknown?: AgentWebSearchEngine[]
}

export interface AgentWebSearchConfig {
  enabled: boolean;
  engines: AgentWebSearchEngine[];
  engineOrder: AgentWebSearchEngine[];
  apiKeys: Partial<Record<AgentWebSearchEngine, string>>;
  resultLimit: number;
  domains: string[];
  endpoint?: string;
  scope?: string;
  includeSummary?: boolean;
  includeRawContent?: boolean;
  parallelMaxEngines: number;
  parallelMaxQueriesPerCall: number;
  parallelTimeoutMs: number;
  mergeStrategy: AgentWebSearchMergeStrategy;
  autoBilingual: boolean;
  autoBilingualMode: AgentWebSearchBilingualMode;
  autoReadAfterSearch?: boolean;
  autoReadTopK?: number;
  autoReadParallelism?: number;
  autoReadTimeoutMs?: number;
  autoReadMaxContentLength?: number;
  minSources?: number;
  conflictEscalation?: AgentWebSearchConflictEscalation;
  localeRouting?: AgentWebSearchLocaleRouting;
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
const WEB_SEARCH_ENGINES: AgentWebSearchEngine[] = ['tavily', 'brave', 'metaso'];

const parseEngineList = (
  raw: string | undefined | null,
  fallback: AgentWebSearchEngine[]
): AgentWebSearchEngine[] => {
  const parsed = parseDomainListSetting(raw)
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is AgentWebSearchEngine =>
      WEB_SEARCH_ENGINES.includes(item as AgentWebSearchEngine)
    );
  if (parsed.length === 0) return [...fallback];
  return Array.from(new Set(parsed));
};

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

  const engines = parseEngineList(
    sysMap.web_search_enabled_engines ?? env.WEB_SEARCH_ENABLED_ENGINES,
    ['tavily']
  );

  const parsedOrder = parseEngineList(
    sysMap.web_search_engine_order ?? env.WEB_SEARCH_ENGINE_ORDER,
    engines
  );
  const engineOrder = [
    ...parsedOrder.filter((engine) => engines.includes(engine)),
    ...engines.filter((engine) => !parsedOrder.includes(engine)),
  ];

  const apiKeys: Partial<Record<AgentWebSearchEngine, string>> = {};
  for (const engine of WEB_SEARCH_ENGINES) {
    const envName = `WEB_SEARCH_API_KEY_${engine.toUpperCase()}` as keyof NodeJS.ProcessEnv;
    const value = (sysMap[`web_search_api_key_${engine}`] || env[envName] || '').trim();
    if (value) {
      apiKeys[engine] = value;
    }
  }

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

  const parallelMaxEngines = clampNumber(
    parseNumberSetting(
      sysMap.web_search_parallel_max_engines ?? env.WEB_SEARCH_PARALLEL_MAX_ENGINES,
      { fallback: 3 }
    ),
    1,
    3
  );

  const parallelMaxQueriesPerCall = clampNumber(
    parseNumberSetting(
      sysMap.web_search_parallel_max_queries_per_call ?? env.WEB_SEARCH_PARALLEL_MAX_QUERIES_PER_CALL,
      { fallback: 2 }
    ),
    1,
    3
  );

  const parallelTimeoutMs = clampNumber(
    parseNumberSetting(
      sysMap.web_search_parallel_timeout_ms ?? env.WEB_SEARCH_PARALLEL_TIMEOUT_MS,
      { fallback: 12000 }
    ),
    1000,
    120000
  );

  const rawMergeStrategy = (
    sysMap.web_search_parallel_merge_strategy ??
    env.WEB_SEARCH_PARALLEL_MERGE_STRATEGY ??
    'hybrid_score_v1'
  )
    .trim()
    .toLowerCase();
  const mergeStrategy: AgentWebSearchMergeStrategy =
    rawMergeStrategy === 'hybrid_score_v1' ? 'hybrid_score_v1' : 'hybrid_score_v1';

  const autoBilingual = parseBooleanSetting(
    sysMap.web_search_auto_bilingual ?? env.WEB_SEARCH_AUTO_BILINGUAL,
    true
  );

  const rawBilingualMode = (
    sysMap.web_search_auto_bilingual_mode ??
    env.WEB_SEARCH_AUTO_BILINGUAL_MODE ??
    'conditional'
  )
    .trim()
    .toLowerCase();
  const autoBilingualMode: AgentWebSearchBilingualMode =
    rawBilingualMode === 'always' || rawBilingualMode === 'off'
      ? rawBilingualMode
      : 'conditional';

  const autoReadAfterSearch = parseBooleanSetting(
    sysMap.web_search_auto_read ?? env.WEB_SEARCH_AUTO_READ,
    true
  );

  const autoReadTopK = clampNumber(
    parseNumberSetting(
      sysMap.web_search_auto_read_top_k ?? env.WEB_SEARCH_AUTO_READ_TOP_K,
      { fallback: 2 }
    ),
    0,
    3
  );

  const autoReadParallelism = clampNumber(
    parseNumberSetting(
      sysMap.web_search_auto_read_parallelism ?? env.WEB_SEARCH_AUTO_READ_PARALLELISM,
      { fallback: 2 }
    ),
    1,
    4
  );

  const autoReadTimeoutMs = clampNumber(
    parseNumberSetting(
      sysMap.web_search_auto_read_timeout_ms ?? env.WEB_SEARCH_AUTO_READ_TIMEOUT_MS,
      { fallback: 18000 }
    ),
    3000,
    120000
  );

  const autoReadMaxContentLength = clampNumber(
    parseNumberSetting(
      sysMap.web_search_auto_read_max_content_length ?? env.WEB_SEARCH_AUTO_READ_MAX_CONTENT_LENGTH,
      { fallback: 24000 }
    ),
    2000,
    300000
  );

  return {
    enabled,
    engines,
    engineOrder,
    apiKeys,
    resultLimit,
    domains,
    endpoint,
    scope,
    includeSummary,
    includeRawContent,
    parallelMaxEngines,
    parallelMaxQueriesPerCall,
    parallelTimeoutMs,
    mergeStrategy,
    autoBilingual,
    autoBilingualMode,
    autoReadAfterSearch,
    autoReadTopK,
    autoReadParallelism,
    autoReadTimeoutMs,
    autoReadMaxContentLength,
    conflictEscalation: 'auto',
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
