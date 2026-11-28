import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Modal: () => null,
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: () => null,
  Text: () => null,
  TextInput: () => null,
  View: () => null,
}));
vi.mock("@expo/vector-icons", () => ({ MaterialCommunityIcons: () => null }));

import { Switch } from "react-native";

import { createTheme } from "../../theme/tokens";
import { SwitchRow } from "./UiPrimitives";

const theme = createTheme("light", null);

function renderSwitchRow(overrides: {
  title?: string;
  subtitle?: string;
  value?: boolean;
  disabled?: boolean;
} = {}) {
  return SwitchRow({
    title: overrides.title ?? "深度思考",
    subtitle: overrides.subtitle ?? "启用模型思维链并展示 CoT 时间轴",
    value: overrides.value ?? true,
    disabled: overrides.disabled ?? false,
    onValueChange: () => {},
    theme,
  });
}

describe("SwitchRow 可访问语义", () => {
  it("整行作为 switch 暴露，带标题、说明与开启状态", () => {
    const row = renderSwitchRow();
    expect(row.props.accessibilityRole).toBe("switch");
    expect(row.props.accessibilityLabel).toBe("深度思考");
    expect(row.props.accessibilityHint).toBe("启用模型思维链并展示 CoT 时间轴");
    expect(row.props.accessibilityState).toEqual({ checked: true, disabled: false });
  });

  it("关闭与禁用状态都能被朗读", () => {
    const row = renderSwitchRow({ value: false, disabled: true });
    expect(row.props.accessibilityState).toEqual({ checked: false, disabled: true });
  });

  it("内层 Switch 不单独暴露，避免重复朗读与双触发", () => {
    const row = renderSwitchRow();
    const children = row.props.children as Array<{ type: unknown; props: Record<string, unknown> }>;
    const innerSwitch = children.find((child) => child.type === Switch);
    expect(innerSwitch).toBeTruthy();
    expect(innerSwitch?.props.accessible).toBe(false);
    expect(innerSwitch?.props.pointerEvents).toBe("none");
    expect(innerSwitch?.props.importantForAccessibility).toBe("no-hide-descendants");
  });

  it("没有说明文字时不留下空提示", () => {
    const row = SwitchRow({
      title: "深度思考",
      value: false,
      onValueChange: () => {},
      theme,
    });
    expect(row.props.accessibilityHint).toBeUndefined();
  });
});
