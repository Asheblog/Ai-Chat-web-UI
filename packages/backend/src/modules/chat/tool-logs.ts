import type { WebSearchHit } from '../../utils/web-search';

export type ToolLogStage = 'start' | 'result' | 'error';

export interface ToolLogDetails {
  code?: string;
  input?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  [key: string]: unknown;
}

export type ToolLogEntry = {
  id: string;
  tool: string;
  stage: ToolLogStage;
  query?: string;
  hits?: WebSearchHit[];
  error?: string;
  summary?: string;
  createdAt: number;
  details?: ToolLogDetails;
};

export const parseToolLogsJson = (raw?: string | null): ToolLogEntry[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const legacyPending = new Map<string, Array<{ id: string; createdAt: number }>>();
    let legacyCounter = 0;
    const LEGACY_WINDOW = 15_000;

    const legacyKey = (tool: string, query?: string) =>
      `${tool}::${(query || '').trim().toLowerCase()}`;

    const allocateLegacyId = (
      key: string,
      stage: ToolLogStage,
      createdAt: number,
    ): string => {
      if (stage === 'start') {
        const id = `legacy:${key}:${legacyCounter++}`;
        const queue = legacyPending.get(key) ?? [];
        queue.push({ id, createdAt });
        legacyPending.set(key, queue);
        return id;
      }
      const queue = legacyPending.get(key);
      if (queue && queue.length > 0) {
        while (queue.length > 0 && createdAt - queue[0].createdAt > LEGACY_WINDOW) {
          queue.shift();
        }
        if (queue.length > 0) {
          const match = queue.shift()!;
          if (queue.length === 0) {
            legacyPending.delete(key);
          } else {
            legacyPending.set(key, queue);
          }
          return match.id;
        }
      }
      return `legacy:${key}:${legacyCounter++}`;
    };

    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const stage = entry.stage;
        if (stage !== 'start' && stage !== 'result' && stage !== 'error') return null;
        const tool = typeof entry.tool === 'string' && entry.tool.trim() ? entry.tool : 'unknown';
        const createdAtRaw =
          typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
            ? entry.createdAt
            : Date.now();
        const query = typeof entry.query === 'string' ? entry.query : undefined;
        const id =
          typeof entry.id === 'string' && entry.id.trim()
            ? entry.id.trim()
            : allocateLegacyId(legacyKey(tool, query), stage, createdAtRaw);
        const log: ToolLogEntry = {
          id,
          tool,
          stage,
          query,
          createdAt: createdAtRaw,
        };
        if (Array.isArray(entry.hits)) {
          log.hits = entry.hits
            .map((hit: any) => {
              if (!hit || typeof hit !== 'object') return null;
              const title = typeof hit.title === 'string' ? hit.title : '';
              const url = typeof hit.url === 'string' ? hit.url : '';
              if (!title && !url) return null;
              const normalized: WebSearchHit = {
                title,
                url,
              };
              if (typeof hit.snippet === 'string') normalized.snippet = hit.snippet;
              if (typeof hit.content === 'string') normalized.content = hit.content;
              return normalized;
            })
            .filter((hit): hit is WebSearchHit => Boolean(hit));
        }
        if (typeof entry.error === 'string' && entry.error.trim()) {
          log.error = entry.error;
        }
        if (typeof entry.summary === 'string' && entry.summary.trim()) {
          log.summary = entry.summary.trim();
        }
        if (entry.details && typeof entry.details === 'object') {
          const candidate = entry.details as Record<string, unknown>;
          const normalized: ToolLogDetails = {};
          if (typeof candidate.code === 'string') normalized.code = candidate.code;
          if (typeof candidate.input === 'string') normalized.input = candidate.input;
          if (typeof candidate.stdout === 'string') normalized.stdout = candidate.stdout;
          if (typeof candidate.stderr === 'string') normalized.stderr = candidate.stderr;
          if (typeof candidate.exitCode === 'number' && Number.isFinite(candidate.exitCode)) {
            normalized.exitCode = candidate.exitCode;
          }
          if (typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)) {
            normalized.durationMs = candidate.durationMs;
          }
          if (typeof candidate.truncated === 'boolean') normalized.truncated = candidate.truncated;
          for (const [key, value] of Object.entries(candidate)) {
            if (
              key === 'code' ||
              key === 'input' ||
              key === 'stdout' ||
              key === 'stderr' ||
              key === 'exitCode' ||
              key === 'durationMs' ||
              key === 'truncated'
            ) {
              continue;
            }
            if (value !== undefined) {
              normalized[key] = value;
            }
          }
          if (Object.keys(normalized).length > 0) {
            log.details = normalized;
          }
        }
        return log;
      })
      .filter((entry): entry is ToolLogEntry => Boolean(entry));
  } catch {
    return [];
  }
};
