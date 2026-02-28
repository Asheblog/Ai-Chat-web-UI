import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../../../db';
import type { ProviderType } from '../../../utils/providers';
import { BackendLogger as log } from '../../../utils/logger';

const PROFILE_SETTING_KEY = 'reasoning_compat_profiles_v1';
const PROFILE_MAX_ENTRIES = 300;

export type ReasoningProtocol = 'chat_completions' | 'responses';

type SignalName =
  | 'responses.reasoning_text.delta'
  | 'responses.reasoning_summary_text.delta'
  | 'delta.reasoning_content'
  | 'delta.reasoning'
  | 'delta.thinking'
  | 'delta.analysis'
  | 'tag.reasoning';

interface ProtocolStats {
  attempts: number;
  reasoningHits: number;
  unsupportedErrors: number;
  totalErrors: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  signals: Partial<Record<SignalName, number>>;
}

interface StoredProfile {
  key: string;
  provider: ProviderType;
  connectionId: number;
  modelRawId: string;
  createdAt: string;
  updatedAt: string;
  protocols: Record<ReasoningProtocol, ProtocolStats>;
  lastDecisionReason: string | null;
  lastUnavailableCode: string | null;
  lastUnavailableReason: string | null;
}

export interface ReasoningCompatibilityProfile {
  key: string;
  provider: ProviderType;
  connectionId: number;
  modelRawId: string;
  createdAt: string;
  updatedAt: string;
  protocols: Record<ReasoningProtocol, ProtocolStats>;
  lastDecisionReason: string | null;
  lastUnavailableCode: string | null;
  lastUnavailableReason: string | null;
}

export interface ProtocolDecision {
  protocol: ReasoningProtocol;
  reason: string;
  profile: ReasoningCompatibilityProfile;
}

export interface AttemptTracker {
  key: string;
  protocol: ReasoningProtocol;
  provider: ProviderType;
  connectionId: number;
  modelRawId: string;
  reasoningEnabled: boolean;
  startedAt: number;
  sawReasoning: boolean;
  signals: Set<SignalName>;
  decisionReason: string;
}

export interface UnavailableNotice {
  code: string;
  reason: string;
  suggestion: string;
}

const createEmptyProtocolStats = (): ProtocolStats => ({
  attempts: 0,
  reasoningHits: 0,
  unsupportedErrors: 0,
  totalErrors: 0,
  lastStatusCode: null,
  lastError: null,
  lastAttemptAt: null,
  signals: {},
});

const isResponsesUnsupportedStatus = (statusCode?: number | null) =>
  statusCode === 404 || statusCode === 405 || statusCode === 501;

export class ReasoningCompatibilityService {
  private prisma: PrismaClient;
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;
  private profiles = new Map<string, StoredProfile>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(deps?: { prisma?: PrismaClient }) {
    this.prisma = deps?.prisma ?? defaultPrisma;
  }

  private buildKey(provider: ProviderType, connectionId: number, modelRawId: string) {
    return `${provider}:${connectionId}:${modelRawId}`;
  }

  private normalizeProfile(raw: any): StoredProfile | null {
    if (!raw || typeof raw !== 'object') return null;
    const provider = raw.provider as ProviderType;
    const connectionId = Number(raw.connectionId);
    const modelRawId = typeof raw.modelRawId === 'string' ? raw.modelRawId : '';
    if (!provider || !Number.isFinite(connectionId) || !modelRawId) return null;
    const key = typeof raw.key === 'string' && raw.key ? raw.key : this.buildKey(provider, connectionId, modelRawId);
    const nowIso = new Date().toISOString();
    return {
      key,
      provider,
      connectionId,
      modelRawId,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso,
      protocols: {
        chat_completions: {
          ...createEmptyProtocolStats(),
          ...(raw.protocols?.chat_completions || {}),
          signals: { ...(raw.protocols?.chat_completions?.signals || {}) },
        },
        responses: {
          ...createEmptyProtocolStats(),
          ...(raw.protocols?.responses || {}),
          signals: { ...(raw.protocols?.responses?.signals || {}) },
        },
      },
      lastDecisionReason: typeof raw.lastDecisionReason === 'string' ? raw.lastDecisionReason : null,
      lastUnavailableCode: typeof raw.lastUnavailableCode === 'string' ? raw.lastUnavailableCode : null,
      lastUnavailableReason: typeof raw.lastUnavailableReason === 'string' ? raw.lastUnavailableReason : null,
    };
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }
    this.loadingPromise = (async () => {
      try {
        const row = await this.prisma.systemSetting.findUnique({
          where: { key: PROFILE_SETTING_KEY },
          select: { value: true },
        });
        if (!row?.value) {
          this.loaded = true;
          return;
        }
        const parsed = JSON.parse(row.value);
        const list = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
        for (const item of list) {
          const normalized = this.normalizeProfile(item);
          if (!normalized) continue;
          this.profiles.set(normalized.key, normalized);
        }
      } catch (error) {
        log.warn('[reasoning-compat] load profile failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.loaded = true;
        this.loadingPromise = null;
      }
    })();
    await this.loadingPromise;
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, 800);
  }

  async flushNow() {
    if (this.flushing) return;
    await this.ensureLoaded();
    this.flushing = true;
    try {
      const all = Array.from(this.profiles.values()).sort((a, b) => {
        const bt = Date.parse(b.updatedAt);
        const at = Date.parse(a.updatedAt);
        if (Number.isFinite(bt) && Number.isFinite(at) && bt !== at) return bt - at;
        return b.key.localeCompare(a.key);
      });
      const trimmed = all.slice(0, PROFILE_MAX_ENTRIES);
      const payload = JSON.stringify({ profiles: trimmed });
      await this.prisma.systemSetting.upsert({
        where: { key: PROFILE_SETTING_KEY },
        create: { key: PROFILE_SETTING_KEY, value: payload },
        update: { value: payload },
      });
      // Persist 时顺便裁剪内存，防止无限增长
      this.profiles = new Map(trimmed.map((item) => [item.key, item]));
    } catch (error) {
      log.warn('[reasoning-compat] flush profile failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.flushing = false;
    }
  }

  private async getOrCreateProfile(params: {
    provider: ProviderType;
    connectionId: number;
    modelRawId: string;
  }): Promise<StoredProfile> {
    await this.ensureLoaded();
    const key = this.buildKey(params.provider, params.connectionId, params.modelRawId);
    const existing = this.profiles.get(key);
    if (existing) return existing;
    const nowIso = new Date().toISOString();
    const created: StoredProfile = {
      key,
      provider: params.provider,
      connectionId: params.connectionId,
      modelRawId: params.modelRawId,
      createdAt: nowIso,
      updatedAt: nowIso,
      protocols: {
        chat_completions: createEmptyProtocolStats(),
        responses: createEmptyProtocolStats(),
      },
      lastDecisionReason: null,
      lastUnavailableCode: null,
      lastUnavailableReason: null,
    };
    this.profiles.set(key, created);
    this.scheduleFlush();
    return created;
  }

  private toPublicProfile(profile: StoredProfile): ReasoningCompatibilityProfile {
    return {
      key: profile.key,
      provider: profile.provider,
      connectionId: profile.connectionId,
      modelRawId: profile.modelRawId,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      protocols: {
        chat_completions: {
          ...profile.protocols.chat_completions,
          signals: { ...profile.protocols.chat_completions.signals },
        },
        responses: {
          ...profile.protocols.responses,
          signals: { ...profile.protocols.responses.signals },
        },
      },
      lastDecisionReason: profile.lastDecisionReason,
      lastUnavailableCode: profile.lastUnavailableCode,
      lastUnavailableReason: profile.lastUnavailableReason,
    };
  }

  async getProfile(params: {
    provider: ProviderType;
    connectionId: number;
    modelRawId: string;
  }): Promise<ReasoningCompatibilityProfile> {
    const profile = await this.getOrCreateProfile(params);
    return this.toPublicProfile(profile);
  }

  async decideProtocol(params: {
    provider: ProviderType;
    connectionId: number;
    modelRawId: string;
    reasoningEnabled: boolean;
  }): Promise<ProtocolDecision> {
    const profile = await this.getOrCreateProfile(params);

    const updateDecision = (protocol: ReasoningProtocol, reason: string): ProtocolDecision => {
      profile.lastDecisionReason = reason;
      profile.updatedAt = new Date().toISOString();
      this.scheduleFlush();
      return {
        protocol,
        reason,
        profile: this.toPublicProfile(profile),
      };
    };

    if (!params.reasoningEnabled) {
      return updateDecision('chat_completions', 'reasoning_disabled');
    }

    if (params.provider === 'openai_responses') {
      return updateDecision('responses', 'provider_is_openai_responses');
    }

    if (params.provider !== 'openai') {
      return updateDecision('chat_completions', 'provider_not_switchable');
    }

    const chatStats = profile.protocols.chat_completions;
    const responsesStats = profile.protocols.responses;

    if (responsesStats.unsupportedErrors > 0) {
      return updateDecision('chat_completions', 'responses_marked_unsupported');
    }

    if (responsesStats.reasoningHits > 0) {
      return updateDecision('responses', 'responses_has_reasoning_history');
    }

    if (chatStats.attempts >= 2 && chatStats.reasoningHits === 0 && responsesStats.attempts === 0) {
      return updateDecision('responses', 'chat_missed_reasoning_try_responses');
    }

    return updateDecision('chat_completions', 'default_chat_completions');
  }

  createAttempt(params: {
    provider: ProviderType;
    connectionId: number;
    modelRawId: string;
    protocol: ReasoningProtocol;
    reasoningEnabled: boolean;
    decisionReason: string;
  }): AttemptTracker {
    const key = this.buildKey(params.provider, params.connectionId, params.modelRawId);
    return {
      key,
      protocol: params.protocol,
      provider: params.provider,
      connectionId: params.connectionId,
      modelRawId: params.modelRawId,
      reasoningEnabled: params.reasoningEnabled,
      startedAt: Date.now(),
      sawReasoning: false,
      signals: new Set<SignalName>(),
      decisionReason: params.decisionReason,
    };
  }

  markSignal(attempt: AttemptTracker | null, signal: SignalName) {
    if (!attempt) return;
    attempt.signals.add(signal);
    if (signal !== 'tag.reasoning') {
      attempt.sawReasoning = true;
    }
  }

  markReasoningObserved(attempt: AttemptTracker | null) {
    if (!attempt) return;
    attempt.sawReasoning = true;
  }

  async finalizeAttempt(
    attempt: AttemptTracker | null,
    params?: {
      statusCode?: number | null;
      error?: string | null;
    },
  ): Promise<ReasoningCompatibilityProfile | null> {
    if (!attempt) return null;
    const profile = await this.getOrCreateProfile({
      provider: attempt.provider,
      connectionId: attempt.connectionId,
      modelRawId: attempt.modelRawId,
    });
    const stats = profile.protocols[attempt.protocol];
    stats.attempts += 1;
    stats.lastAttemptAt = new Date().toISOString();
    if (attempt.sawReasoning) {
      stats.reasoningHits += 1;
    }
    if (typeof params?.statusCode === 'number' && Number.isFinite(params.statusCode)) {
      stats.lastStatusCode = params.statusCode;
      if (params.statusCode >= 400) {
        stats.totalErrors += 1;
      }
      if (attempt.protocol === 'responses' && isResponsesUnsupportedStatus(params.statusCode)) {
        stats.unsupportedErrors += 1;
      }
    } else {
      stats.lastStatusCode = null;
    }
    if (params?.error) {
      stats.lastError = params.error;
    } else {
      stats.lastError = null;
    }
    for (const signal of attempt.signals) {
      stats.signals[signal] = (stats.signals[signal] || 0) + 1;
    }
    profile.lastDecisionReason = attempt.decisionReason;
    profile.updatedAt = new Date().toISOString();
    this.profiles.set(profile.key, profile);
    this.scheduleFlush();
    return this.toPublicProfile(profile);
  }

  async markUnavailable(
    params: {
      provider: ProviderType;
      connectionId: number;
      modelRawId: string;
    },
    notice: UnavailableNotice,
  ) {
    const profile = await this.getOrCreateProfile(params);
    profile.lastUnavailableCode = notice.code;
    profile.lastUnavailableReason = notice.reason;
    profile.updatedAt = new Date().toISOString();
    this.scheduleFlush();
    return this.toPublicProfile(profile);
  }

  buildUnavailableNotice(params: {
    attempt: AttemptTracker | null;
    profile: ReasoningCompatibilityProfile | null;
  }): UnavailableNotice | null {
    const { attempt, profile } = params;
    if (!attempt || !attempt.reasoningEnabled || attempt.sawReasoning) return null;
    const protocol = attempt.protocol;
    if (protocol === 'responses' && (profile?.protocols.responses.unsupportedErrors || 0) > 0) {
      return {
        code: 'responses_unsupported',
        reason: '当前中转不支持 Responses 协议（/responses），无法返回可展示推理内容。',
        suggestion: '请使用 Chat Completions 或更换支持 Responses 的中转。',
      };
    }
    if (protocol === 'responses') {
      return {
        code: 'responses_no_reasoning',
        reason: 'Responses 已开启，但上游未返回 reasoning_text/reasoning_summary_text。',
        suggestion: '检查中转是否裁剪了 reasoning 事件，或尝试切换模型。',
      };
    }
    const responsesUnsupportedInHistory = (profile?.protocols.responses.unsupportedErrors || 0) > 0;
    if (responsesUnsupportedInHistory && attempt.decisionReason.includes('fallback_chat')) {
      return {
        code: 'responses_unsupported_fallback_chat_no_reasoning',
        reason: '当前中转不支持 Responses，已回退 Chat Completions，但仍未返回可展示推理字段。',
        suggestion: '建议更换支持 Responses 的中转，或接受仅返回最终答案（无可展示推理）。',
      };
    }
    return {
      code: 'chat_no_reasoning',
      reason:
        '上游未返回推理字段（reasoning_content / reasoning / thinking / analysis），或中转已剥离 CoT。',
      suggestion: '可尝试切换到支持 Responses 的连接，或使用“兼容性重测”确认中转行为。',
    };
  }
}

let singleton: ReasoningCompatibilityService | null = null;

export const getReasoningCompatibilityService = () => {
  if (!singleton) {
    singleton = new ReasoningCompatibilityService();
  }
  return singleton;
};

export const reasoningCompatibilityService = getReasoningCompatibilityService();
