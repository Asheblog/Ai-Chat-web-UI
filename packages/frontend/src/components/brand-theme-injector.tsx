"use client"

import { useEffect } from "react"
import {
  applyBrandThemeToElement,
  type BrandThemeColors,
} from "@aichat/shared"
import { useSettingsStore } from "@/store/settings-store"

interface BrandThemeInjectorProps {
  initialTheme?: BrandThemeColors
}

function pickThemeFromSettings(settings: {
  brandPrimary?: string | null
  brandPrimaryForeground?: string | null
  brandBackground?: string | null
  brandSurface?: string | null
  brandForeground?: string | null
  brandMutedForeground?: string | null
} | null | undefined): BrandThemeColors {
  if (!settings) return {}
  return {
    brand_primary: settings.brandPrimary,
    brand_primary_foreground: settings.brandPrimaryForeground,
    brand_background: settings.brandBackground,
    brand_surface: settings.brandSurface,
    brand_foreground: settings.brandForeground,
    brand_muted_foreground: settings.brandMutedForeground,
  }
}

export function BrandThemeInjector({ initialTheme }: BrandThemeInjectorProps) {
  const systemSettings = useSettingsStore((s) => s.systemSettings)
  const publicBrandTheme = useSettingsStore((s) => s.publicBrandTheme)

  useEffect(() => {
    const theme: BrandThemeColors = {
      ...(initialTheme ?? {}),
      ...(publicBrandTheme ?? {}),
      ...pickThemeFromSettings(systemSettings),
    }
    applyBrandThemeToElement(document.documentElement, theme)
  }, [initialTheme, publicBrandTheme, systemSettings])

  return null
}
