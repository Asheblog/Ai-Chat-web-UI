import type { ColorSchemeName } from "react-native";

export const spacing = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
} as const;

export function createTheme(colorScheme: ColorSchemeName) {
  const isDark = colorScheme === "dark";

  return {
    avatarBackground: isDark ? "#1D4ED8" : "#DBEAFE",
    background: isDark ? "#0F172A" : "#FFFFFF",
    border: isDark ? "#334155" : "#E4ECFC",
    danger: isDark ? "#FCA5A5" : "#B91C1C",
    dangerSurface: isDark ? "#451A1A" : "#FEF2F2",
    foreground: isDark ? "#F8FAFC" : "#0F172A",
    inputBackground: isDark ? "#020617" : "#FFFFFF",
    mutedForeground: isDark ? "#CBD5E1" : "#475569",
    primary: "#2563EB",
    primaryPressed: "#1D4ED8",
    primarySurface: isDark ? "#1E3A8A" : "#EFF6FF",
    statusBarStyle: isDark ? "light" : "dark",
    success: isDark ? "#6EE7B7" : "#047857",
    successSurface: isDark ? "#064E3B" : "#ECFDF5",
    surface: isDark ? "#111827" : "#F8FAFC",
  } as const;
}

export type AppTheme = ReturnType<typeof createTheme>;
