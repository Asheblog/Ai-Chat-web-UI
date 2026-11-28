import AsyncStorage from "@react-native-async-storage/async-storage";

import type { MobilePreferences } from "../types/mobile";

const PREFERENCES_KEY = "aichat.mobilePreferences.v1";

export const DEFAULT_MOBILE_PREFERENCES: MobilePreferences = {
  themeMode: "system",
  syncServerBrand: true,
  hapticsEnabled: true,
  voiceLocale: "zh-CN",
  defaultReasoningEnabled: true,
  defaultReasoningEffort: "medium",
  defaultWebSearchEnabled: false,
};

export async function loadMobilePreferences(): Promise<MobilePreferences> {
  try {
    const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
    if (!raw) {
      return DEFAULT_MOBILE_PREFERENCES;
    }
    const parsed = JSON.parse(raw) as Partial<MobilePreferences>;
    return {
      ...DEFAULT_MOBILE_PREFERENCES,
      ...parsed,
    };
  } catch {
    return DEFAULT_MOBILE_PREFERENCES;
  }
}

export async function saveMobilePreferences(prefs: MobilePreferences): Promise<void> {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}
