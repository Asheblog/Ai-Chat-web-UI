import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import type { BrandThemeColors } from "@aichat/shared";

import type { BrandingInfo } from "../types/mobile";
import {
  createTheme,
  resolveColorScheme,
  type AppTheme,
  type ResolvedColorScheme,
  type ThemeMode,
} from "./tokens";

type ThemeContextValue = {
  theme: AppTheme;
  themeMode: ThemeMode;
  resolvedScheme: ResolvedColorScheme;
  syncServerBrand: boolean;
  brandTheme: BrandThemeColors | null;
  setThemeMode: (mode: ThemeMode) => void;
  setSyncServerBrand: (sync: boolean) => void;
  applyBranding: (branding: BrandingInfo | null | undefined) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialMode = "system",
  initialSyncBrand = true,
  initialBrandTheme = null,
}: {
  children: ReactNode;
  initialMode?: ThemeMode;
  initialSyncBrand?: boolean;
  initialBrandTheme?: BrandThemeColors | null;
}) {
  const systemScheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialMode);
  const [syncServerBrand, setSyncServerBrand] = useState<boolean>(initialSyncBrand);
  const [brandTheme, setBrandTheme] = useState<BrandThemeColors | null>(initialBrandTheme);

  const resolvedScheme = useMemo(
    () => resolveColorScheme(themeMode, systemScheme),
    [systemScheme, themeMode],
  );

  const theme = useMemo(
    () => createTheme(resolvedScheme, syncServerBrand ? brandTheme : null),
    [brandTheme, resolvedScheme, syncServerBrand],
  );

  const applyBranding = useCallback((branding: BrandingInfo | null | undefined) => {
    if (!branding) {
      setBrandTheme(null);
      return;
    }
    setBrandTheme({
      brand_primary: branding.brand_primary,
      brand_primary_foreground: branding.brand_primary_foreground,
      brand_background: branding.brand_background,
      brand_surface: branding.brand_surface,
      brand_foreground: branding.brand_foreground,
      brand_muted_foreground: branding.brand_muted_foreground,
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      themeMode,
      resolvedScheme,
      syncServerBrand,
      brandTheme,
      setThemeMode,
      setSyncServerBrand,
      applyBranding,
    }),
    [applyBranding, brandTheme, resolvedScheme, syncServerBrand, theme, themeMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used inside ThemeProvider");
  }
  return ctx;
}
