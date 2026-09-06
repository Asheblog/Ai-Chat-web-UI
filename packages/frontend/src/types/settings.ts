import type { BrandThemeColors } from '@aichat/shared'
import type { SystemSettings } from '@aichat/shared/settings-codec'

// 系统设置类型
export interface SystemSetting {
  key: string;
  value: string;
}

export interface PythonRuntimeIndexes {
  indexUrl?: string;
  extraIndexUrls: string[];
  trustedHosts: string[];
  autoInstallOnActivate: boolean;
  autoInstallOnMissing: boolean;
}

export interface PythonRuntimeInstalledPackage {
  name: string;
  version: string;
}

export type PythonRuntimePackageSourceTag = 'manual' | 'skill_manifest' | 'skill_auto' | 'python_auto';

export interface PythonRuntimePackageSourceItem {
  name: string;
  sources: PythonRuntimePackageSourceTag[];
}

export interface PythonRuntimeDependencyItem {
  skillId: number;
  skillSlug: string;
  skillDisplayName: string;
  versionId: number;
  version: string;
  requirement: string;
  packageName: string;
}

export interface PythonRuntimeConflictItem {
  packageName: string;
  requirements: string[];
  skills: Array<{
    skillId: number;
    skillSlug: string;
    versionId: number;
    version: string;
    requirement: string;
  }>;
}

export interface PythonRuntimeStatus {
  dataRoot: string;
  runtimeRoot: string;
  venvPath: string;
  pythonPath: string;
  ready: boolean;
  runtimeIssue?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  indexes: PythonRuntimeIndexes;
  manualPackages: string[];
  installedPackages: PythonRuntimeInstalledPackage[];
  packageSources: PythonRuntimePackageSourceItem[];
  activeDependencies: PythonRuntimeDependencyItem[];
  conflicts: PythonRuntimeConflictItem[];
}

export interface SettingsState {
  contextEnabled: boolean;
  newConversationContextEnabled: boolean;
  systemSettings: SystemSettings | null;
  isLoading: boolean;
  error: string | null;
  publicBrandText: string | null;
  publicBrandTheme: BrandThemeColors | null;
  assistantAvatarReady: boolean;
  assistantAvatarReadyFor: string | null;
}
