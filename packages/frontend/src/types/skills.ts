export interface SkillCatalogItem {
  id: number;
  namespaceKey?: string;
  slug: string;
  displayName: string;
  description?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  sourceKey?: string | null;
  storeItemKey?: string | null;
  visibility?: 'system' | 'user_private' | string | null;
  ownerUserId?: number | null;
  licenseName?: string | null;
  licenseUrl?: string | null;
  licenseStatus?: string | null;
  status?: string | null;
  defaultVersion?: SkillVersionItem | null;
  versions?: SkillVersionItem[];
  sessionBinding?: {
    id: number;
    enabled: boolean;
    versionId?: number | null;
  } | null;
}

export interface SkillVersionItem {
  id: number;
  version: string;
  status: string;
  riskLevel?: string | null;
  sourceRef?: string | null;
  sourceSubdir?: string | null;
  createdAt?: string | Date | null;
  approvedAt?: string | Date | null;
  activatedAt?: string | Date | null;
  manifest?: Record<string, unknown>;
}

export interface SkillUninstallDependencyConsumer {
  skillId: number;
  skillSlug: string;
  skillDisplayName: string;
  versionId: number;
  version: string;
  requirement: string;
}

export interface SkillUninstallDependencySource {
  packageName: string;
  consumers: SkillUninstallDependencyConsumer[];
}

export interface SkillUninstallCleanupPlan {
  removedSkillPackages: string[];
  keptByActiveSkills: string[];
  keptByActiveSkillSources: SkillUninstallDependencySource[];
  keptByManual: string[];
  removablePackages: string[];
}

export interface SkillUninstallPreviewData {
  skillId: number;
  slug: string;
  displayName: string;
  removedRequirements: string[];
  packagePaths: string[];
  cleanupPlan: SkillUninstallCleanupPlan;
}

export interface SkillBindingItem {
  id: number;
  skillId: number;
  versionId?: number | null;
  scopeType: 'system' | 'user' | 'session' | 'battle_model';
  scopeId: string;
  enabled: boolean;
  policyJson?: string | null;
  overridesJson?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  skill?: {
    id: number;
    slug: string;
    displayName: string;
  };
  version?: {
    id: number;
    version: string;
    status: string;
  } | null;
}

export interface SkillApprovalRequestItem {
  id: number;
  skillId: number;
  versionId?: number | null;
  bindingId?: number | null;
  sessionId?: number | null;
  battleRunId?: number | null;
  messageId?: number | null;
  toolName: string;
  toolCallId?: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  reason?: string | null;
  requestPayloadJson?: string | null;
  decisionNote?: string | null;
  requestedByActor: string;
  requestedAt?: string | Date | null;
  decidedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  skill?: {
    id: number;
    slug: string;
    displayName: string;
  };
  version?: {
    id: number;
    version: string;
    status: string;
    riskLevel?: string | null;
  } | null;
  binding?: {
    id: number;
    scopeType: 'system' | 'user' | 'session' | 'battle_model';
    scopeId: string;
  } | null;
  decidedBy?: {
    id: number;
    username: string;
  } | null;
}

export interface SkillExecutionAuditItem {
  id: number;
  skillId: number;
  versionId?: number | null;
  approvalRequestId?: number | null;
  sessionId?: number | null;
  battleRunId?: number | null;
  messageId?: number | null;
  toolName: string;
  toolCallId?: string | null;
  requestPayloadJson?: string | null;
  responsePayloadJson?: string | null;
  approvalStatus?: string | null;
  platform?: string | null;
  durationMs?: number | null;
  error?: string | null;
  createdAt?: string | Date | null;
  skill?: {
    id: number;
    slug: string;
    displayName: string;
  };
  version?: {
    id: number;
    version: string;
    status: string;
    riskLevel?: string | null;
  } | null;
  approvalRequest?: {
    id: number;
    status: string;
    requestedAt?: string | Date | null;
    decidedAt?: string | Date | null;
    requestedByActor?: string;
    decidedByUserId?: number | null;
  } | null;
}

export interface SkillRuntimeReference {
  skillId: number;
  versionId: number;
  overrides?: Record<string, unknown>;
}

export interface SkillStoreSourceItem {
  key: string;
  name: string;
  repository: string;
  ref: string;
  description: string;
  homepageUrl: string;
  tags: string[];
  status: 'live' | 'fallback';
}

export interface SkillStoreItem {
  key: string;
  sourceKey: string;
  sourceName: string;
  sourceUrl: string;
  repository: string;
  ref: string;
  subdir: string;
  slug: string;
  displayName: string;
  description: string;
  skillUrl: string;
  licenseName?: string | null;
  licenseUrl?: string | null;
  licenseStatus: string;
  installable: boolean;
  tags: string[];
  installed?: {
    skillId: number;
    versionId?: number | null;
    version?: string | null;
    status: string;
  } | null;
}

export interface SkillStoreResponseData {
  items: SkillStoreItem[];
  sources: SkillStoreSourceItem[];
  refreshedAt: string;
  anonymous: boolean;
}

export interface SessionSkillOptionsData {
  items: SkillCatalogItem[];
}

export interface SkillApprovalEvent {
  type: 'skill_approval_request' | 'skill_approval_result';
  requestId: number;
  skillId: number;
  skillSlug: string;
  skillVersionId?: number;
  tool?: string;
  toolCallId?: string;
  reason?: string;
  decision?: 'approved' | 'denied' | 'expired';
  expiresAt?: string | Date;
}
