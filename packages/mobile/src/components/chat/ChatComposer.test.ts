import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Image: () => null,
  Pressable: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: () => null,
  TextInput: () => null,
  View: () => null,
}));
vi.mock("@expo/vector-icons", () => ({ MaterialCommunityIcons: () => null }));
vi.mock("../../native/haptics", () => ({ lightTap: vi.fn() }));
vi.mock("../ui/UiPrimitives", () => ({ ActionMenuModal: () => null }));

import { ComposerAction } from "./ChatComposer";

type StyleRecord = Record<string, unknown>;

const flattenStyle = (style: unknown): StyleRecord[] =>
  (Array.isArray(style) ? style : [style]).filter(
    (item): item is StyleRecord => Boolean(item) && typeof item === "object",
  );

describe("ComposerAction 触控与可访问性", () => {
  it("主操作使用 44×44 实际布局盒，按压仅做透明度反馈", () => {
    const action = ComposerAction({
      label: "发送消息",
      onPress: () => {},
      children: null,
      disabled: false,
    });

    expect(action.props.accessibilityRole).toBe("button");
    expect(action.props.accessibilityLabel).toBe("发送消息");
    expect(action.props.accessibilityState).toEqual({ disabled: false });
    expect(action.props.disabled).toBe(false);

    expect(flattenStyle(action.props.style({ pressed: false }))).toContainEqual(
      expect.objectContaining({ width: 44, height: 44 }),
    );
    expect(flattenStyle(action.props.style({ pressed: true }))).toContainEqual(
      expect.objectContaining({ opacity: 0.72 }),
    );
  });

  it("语音选中态可朗读，禁用时不再给出按压反馈", () => {
    const selected = ComposerAction({
      label: "语音输入",
      onPress: () => {},
      children: null,
      selected: true,
    });
    expect(selected.props.accessibilityState).toEqual({ selected: true });

    const disabled = ComposerAction({
      label: "发送消息",
      onPress: () => {},
      children: null,
      disabled: true,
    });
    expect(disabled.props.accessibilityState).toEqual({ disabled: true });
    expect(disabled.props.disabled).toBe(true);
    expect(
      flattenStyle(disabled.props.style({ pressed: true })).some(
        (item) => item.opacity === 0.72,
      ),
    ).toBe(false);
  });

  it("未声明 disabled / selected 时不生成多余状态", () => {
    const action = ComposerAction({
      label: "停止生成",
      onPress: () => {},
      children: null,
    });

    expect(action.props.accessibilityState).toBeUndefined();
    expect(action.props.disabled).toBeUndefined();
    expect(flattenStyle(action.props.style({ pressed: true }))).toContainEqual(
      expect.objectContaining({ width: 44, height: 44 }),
    );
  });
});
