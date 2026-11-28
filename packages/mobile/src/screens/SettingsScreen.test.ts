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
  useColorScheme: () => "light",
}));
vi.mock("@expo/vector-icons", () => ({ MaterialCommunityIcons: () => null }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  selectionAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

import {
  canSubmitPersonalSettings,
  initialPersonalSettingsState as initial,
  personalSettingsReducer as reduce,
} from "./SettingsScreen";

function loadScoped(scope: number) {
  return reduce(initial, { type: "reload", scope });
}

function readyAt(scope: number, prompt = "服务端提示词", contextEnabled = true) {
  return reduce(loadScoped(scope), { type: "loaded", scope, prompt, contextEnabled });
}

describe("设置页个人设置同步状态", () => {
  it("读取成功后采用服务端值并允许提交", () => {
    const state = readyAt(3, "保持简洁", false);
    expect(state.status).toBe("ready");
    expect(state.prompt).toBe("保持简洁");
    expect(state.contextEnabled).toBe(false);
    expect(canSubmitPersonalSettings(state)).toBe(true);
  });

  it("读取失败时保留错误并禁止提交，避免用默认值覆盖服务端", () => {
    const failed = reduce(loadScoped(1), { type: "failed", scope: 1, message: "网络不可达" });
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("网络不可达");
    expect(canSubmitPersonalSettings(failed)).toBe(false);
  });

  it("切换服务器后旧请求的响应不会写入新服务器", () => {
    const switched = loadScoped(2);
    const staleLoad = reduce(switched, {
      type: "loaded",
      scope: 1,
      prompt: "旧服务器提示词",
      contextEnabled: false,
    });
    expect(staleLoad.status).toBe("loading");
    expect(staleLoad.prompt).toBe("");

    const staleFailure = reduce(switched, { type: "failed", scope: 1, message: "旧请求失败" });
    expect(staleFailure.status).toBe("loading");
    expect(staleFailure.error).toBe(null);
  });

  it("重试会进入加载态并清除上一次错误", () => {
    const failed = reduce(loadScoped(1), { type: "failed", scope: 1, message: "网络不可达" });
    const retried = reduce(failed, { type: "reload", scope: 2 });
    expect(retried.status).toBe("loading");
    expect(retried.error).toBe(null);
    expect(canSubmitPersonalSettings(retried)).toBe(false);
  });

  it("保存中禁止重复提交，也不接受会与在途请求分叉的编辑", () => {
    const ready = readyAt(1);
    const saving = reduce(ready, { type: "saveStarted", scope: 1 });
    expect(saving.saving).toBe(true);
    expect(canSubmitPersonalSettings(saving)).toBe(false);
    expect(reduce(saving, { type: "saveStarted", scope: 1 }).saving).toBe(true);
    expect(reduce(saving, { type: "editPrompt", value: "在途修改" }).prompt).toBe("服务端提示词");
    expect(
      reduce(saving, { type: "setContextEnabled", value: false }).contextEnabled,
    ).toBe(true);
  });

  it("未就绪时忽略保存动作", () => {
    expect(reduce(initial, { type: "saveStarted", scope: 0 }).saving).toBe(false);
    const failed = reduce(loadScoped(1), { type: "failed", scope: 1, message: "读取失败" });
    expect(reduce(failed, { type: "saveStarted", scope: 1 }).saving).toBe(false);
  });

  it("保存成功清除保存态并给出反馈，迟到的结果不串到新服务器", () => {
    const saving = reduce(readyAt(1), { type: "saveStarted", scope: 1 });
    const saved = reduce(saving, { type: "saveSucceeded", scope: 1, message: "个人设置已同步" });
    expect(saved.saving).toBe(false);
    expect(saved.feedback).toBe("个人设置已同步");

    const otherServer = reduce(readyAt(1), { type: "reload", scope: 7 });
    const late = reduce(otherServer, { type: "saveSucceeded", scope: 1, message: "旧服务器已保存" });
    expect(late.feedback).toBe(null);
  });

  it("保存失败保留可编辑状态并显示错误", () => {
    const saving = reduce(readyAt(1), { type: "saveStarted", scope: 1 });
    const failed = reduce(saving, { type: "saveFailed", scope: 1, message: "请求超时" });
    expect(failed.status).toBe("ready");
    expect(failed.saving).toBe(false);
    expect(failed.error).toBe("请求超时");
    expect(canSubmitPersonalSettings(failed)).toBe(true);
  });
});
