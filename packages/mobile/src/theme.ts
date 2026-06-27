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
    background: isDark ? "#0F172A" : "#FFFFFF",
    border: isDark ? "#334155" : "#E4ECFC",
    foreground: isDark ? "#F8FAFC" : "#0F172A",
    mutedForeground: isDark ? "#CBD5E1" : "#475569",
    primary: "#2563EB",
    primaryPressed: "#1D4ED8",
    primarySurface: isDark ? "#1E3A8A" : "#EFF6FF",
    statusBarStyle: isDark ? "light" : "dark",
    surface: isDark ? "#111827" : "#F8FAFC",
  } as const;
}
