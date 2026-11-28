import type { ColorSchemeName } from "react-native";
import { normalizeBrandHex, type BrandThemeColors } from "@aichat/shared";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedColorScheme = "light" | "dark";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export type AppTheme = {
  scheme: ResolvedColorScheme;
  statusBarStyle: "light" | "dark";
  background: string;
  backgroundAlt: string;
  surface: string;
  surfaceSubtle: string;
  surfaceHover: string;
  foreground: string;
  mutedForeground: string;
  tertiaryForeground: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryPressed: string;
  primaryForeground: string;
  primarySurface: string;
  signalText: string;
  userBubble: string;
  codeBackground: string;
  codeHeader: string;
  inputBackground: string;
  avatarBackground: string;
  danger: string;
  dangerSurface: string;
  success: string;
  successSurface: string;
  warning: string;
  warningSurface: string;
  scrim: string;
};

const LIGHT_THEME: AppTheme = {
  scheme: "light",
  statusBarStyle: "dark",
  background: "#F6F6F2",
  backgroundAlt: "#F0F0EC",
  surface: "#FFFFFF",
  surfaceSubtle: "#F0F0EC",
  surfaceHover: "#EAEAE4",
  foreground: "#14161A",
  mutedForeground: "#41464E",
  tertiaryForeground: "#6A6E72",
  border: "#E6E6DF",
  borderStrong: "#D8D8CE",
  primary: "#0F766E",
  primaryPressed: "#0B5F58",
  primaryForeground: "#FFFFFF",
  primarySurface: "#E7F4F1",
  signalText: "#0B5B55",
  userBubble: "#F0F0EC",
  codeBackground: "#F3F3EE",
  codeHeader: "#EAEAE3",
  inputBackground: "#FFFFFF",
  avatarBackground: "#E7F4F1",
  danger: "#BF3B2C",
  dangerSurface: "#FDF2F1",
  success: "#15803D",
  successSurface: "#ECFDF3",
  warning: "#A16207",
  warningSurface: "#FEF9EC",
  scrim: "rgba(15, 20, 18, 0.42)",
};

const DARK_THEME: AppTheme = {
  scheme: "dark",
  statusBarStyle: "light",
  background: "#0D0F0B",
  backgroundAlt: "#131610",
  surface: "#131610",
  surfaceSubtle: "#1A1E16",
  surfaceHover: "#22271D",
  foreground: "#ECEEE7",
  mutedForeground: "#B3B8AC",
  tertiaryForeground: "#8E9389",
  border: "#282E23",
  borderStrong: "#373E31",
  primary: "#36D3C4",
  primaryPressed: "#2AC0B2",
  primaryForeground: "#0D0F0B",
  primarySurface: "#16302D",
  signalText: "#62E3D7",
  userBubble: "#22271D",
  codeBackground: "#171B13",
  codeHeader: "#1F241A",
  inputBackground: "#131610",
  avatarBackground: "#16302D",
  danger: "#E06B5E",
  dangerSurface: "#321614",
  success: "#69CE8D",
  successSurface: "#122B1B",
  warning: "#D9A04A",
  warningSurface: "#2E2211",
  scrim: "rgba(0, 0, 0, 0.64)",
};

export function resolveColorScheme(
  mode: ThemeMode,
  systemScheme: ColorSchemeName,
): ResolvedColorScheme {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return systemScheme === "dark" ? "dark" : "light";
}

function darkenHex(hex: string, amount = 0.16): string {
  const normalized = normalizeBrandHex(hex);
  if (!normalized) return hex;
  const r = Math.max(0, Math.round(Number.parseInt(normalized.slice(1, 3), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(Number.parseInt(normalized.slice(3, 5), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(Number.parseInt(normalized.slice(5, 7), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function mixWithHex(hex: string, targetHex: string, ratio: number): string {
  const a = normalizeBrandHex(hex);
  const b = normalizeBrandHex(targetHex);
  if (!a || !b) return hex;
  const parse = (c: string) => [
    Number.parseInt(c.slice(1, 3), 16),
    Number.parseInt(c.slice(3, 5), 16),
    Number.parseInt(c.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const mix = (x: number, y: number) => Math.round(x * (1 - ratio) + y * ratio);
  return `#${mix(ar, br).toString(16).padStart(2, "0")}${mix(ag, bg).toString(16).padStart(2, "0")}${mix(ab, bb).toString(16).padStart(2, "0")}`.toUpperCase();
}

/**
 * 构建移动端 Ink & Mist 主题，并按 @aichat/shared/brand-theme 规则应用服务端品牌色覆写：
 * - 深色模式保留墨绿夜底（仅同步主信号色），确保夜间可读性；
 * - 浅色模式可同步背景/面板/文字品牌色。
 */
export function createTheme(
  colorScheme: ColorSchemeName,
  brandColors?: BrandThemeColors | null,
): AppTheme {
  const isDark = colorScheme === "dark";
  const base: AppTheme = isDark ? { ...DARK_THEME } : { ...LIGHT_THEME };

  if (!brandColors) {
    return base;
  }

  const primary = normalizeBrandHex(brandColors.brand_primary);
  if (primary) {
    base.primary = primary;
    base.primaryPressed = darkenHex(primary, 0.15);
    base.primarySurface = isDark ? mixWithHex(primary, "#0D0F0B", 0.82) : mixWithHex(primary, "#FFFFFF", 0.88);
    base.avatarBackground = base.primarySurface;
    base.signalText = isDark ? mixWithHex(primary, "#FFFFFF", 0.25) : darkenHex(primary, 0.18);
  }

  const primaryFg = normalizeBrandHex(brandColors.brand_primary_foreground);
  if (primaryFg) {
    base.primaryForeground = primaryFg;
  }

  if (!isDark) {
    const bg = normalizeBrandHex(brandColors.brand_background);
    const surface = normalizeBrandHex(brandColors.brand_surface);
    const fg = normalizeBrandHex(brandColors.brand_foreground);
    const mutedFg = normalizeBrandHex(brandColors.brand_muted_foreground);
    if (bg) base.background = bg;
    if (surface) {
      base.surface = surface;
      base.inputBackground = surface;
    }
    if (fg) base.foreground = fg;
    if (mutedFg) base.mutedForeground = mutedFg;
  }

  return base;
}
