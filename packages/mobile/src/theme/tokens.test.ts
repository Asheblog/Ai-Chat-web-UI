import { describe, expect, it } from "vitest";

import { createTheme, resolveColorScheme } from "./tokens";

describe("Ink & Mist 移动端主题", () => {
  it("默认浅色与深色色板对齐 Ink & Mist", () => {
    const light = createTheme("light");
    const dark = createTheme("dark");

    expect(light.background).toBe("#F6F6F2");
    expect(light.surface).toBe("#FFFFFF");
    expect(light.primary).toBe("#0F766E");
    expect(light.foreground).toBe("#14161A");

    expect(dark.background).toBe("#0D0F0B");
    expect(dark.surface).toBe("#131610");
    expect(dark.primary).toBe("#36D3C4");
    expect(dark.foreground).toBe("#ECEEE7");
  });

  it("浅色同步全部品牌色，深色保留墨绿夜底只同步主信号色", () => {
    const brand = {
      brand_primary: "#7c3aed",
      brand_background: "#fefefe",
      brand_surface: "#fafafa",
      brand_foreground: "#111111",
    };

    const light = createTheme("light", brand);
    const dark = createTheme("dark", brand);

    expect(light.primary).toBe("#7C3AED");
    expect(light.background).toBe("#FEFEFE");
    expect(light.surface).toBe("#FAFAFA");
    expect(light.foreground).toBe("#111111");

    expect(dark.primary).toBe("#7C3AED");
    expect(dark.background).toBe("#0D0F0B");
    expect(dark.surface).toBe("#131610");
    expect(dark.foreground).toBe("#ECEEE7");
  });

  it("resolveColorScheme 正确处理 system/light/dark", () => {
    expect(resolveColorScheme("system", "dark")).toBe("dark");
    expect(resolveColorScheme("system", "light")).toBe("light");
    expect(resolveColorScheme("light", "dark")).toBe("light");
    expect(resolveColorScheme("dark", "light")).toBe("dark");
  });
});
