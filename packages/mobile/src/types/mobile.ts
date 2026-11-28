import type { BrandThemeColors } from "@aichat/shared";
import type { GeneratedImage, ToolCallStatus } from "@aichat/shared/chat-stream-contract";
import type { ToolEvent } from "@aichat/shared/tool-events";
import type { Pagination } from "@aichat/shared/api-contract";

export type ReasoningEffort = "low" | "medium" | "high" | "max" | "xhigh";

export type ServerProfile = {
  id: string;
  name: string;
  endpoint: string;
  lastConnectedAt: string;
  brandText?: string | null;
  brandTheme?: BrandThemeColors | null;
};

export type BrandingInfo = BrandThemeColors & {
  brand_text?: string | null;
};

export type AppInfo = {
  version?: string;
  name?: string;
  buildTime?: string;
  [key: string]: unknown;
};

export type PersonalSettings = {
  preferred_model?: {
    modelId: string;
    connectionId: number | null;
    rawId: string;
  } | null;
  avatar_url?: string | null;
  username?: string | null;
  personal_prompt?: string | null;
  context_enabled?: boolean;
};

export type KnowledgeBaseItem = {
  id: number;
  name: string;
  description?: string | null;
  isPublic?: boolean;
  documentCount?: number;
  _count?: {
    documents?: number;
  };
};

export type SkillOptionItem = {
  id: number;
  slug: string;
  displayName: string;
  description?: string | null;
  defaultVersion?: {
    id: number;
    version: string;
    riskLevel?: string | null;
  } | null;
  sessionBinding?: {
    id: number;
    enabled: boolean;
    versionId: number;
  } | null;
};

export type McpSessionTool = {
  id?: number;
  connectionId?: number;
  connectionName?: string;
  name?: string;
  originalName?: string;
  description?: string | null;
  enabled?: boolean;
  status?: ToolCallStatus;
};

export type SessionDocumentItem = {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: string;
  chunkCount?: number;
};

export type PendingImageAttachment = {
  id: string;
  uri: string;
  mime: string;
  data: string; // base64 without data: prefix
  fileName?: string;
  sizeBytes?: number;
};

export type MobilePreferences = {
  themeMode: "system" | "light" | "dark";
  syncServerBrand: boolean;
  hapticsEnabled: boolean;
  voiceLocale: string;
  defaultReasoningEnabled: boolean;
  defaultReasoningEffort: ReasoningEffort;
  defaultWebSearchEnabled: boolean;
};

export type MobileMessageListMeta = {
  pagination: Pagination;
};

export type MobileToolEvent = ToolEvent;
export type MobileGeneratedImage = GeneratedImage;
