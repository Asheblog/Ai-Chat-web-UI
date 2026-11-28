import * as Linking from "expo-linking";
import * as Sharing from "expo-sharing";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

import {
  consumeSharedText,
  extractSharedTextFromUrl,
  isShareIntoUrl,
  takeInitialDeepLinkText,
} from "./share-payload";

// 冷启动的 deep link 在 ChatScreen 因切换会话重挂时会再次被 getInitialURL 读到；
// 同一个 URL 只导入一次，避免重复追加到输入框。
const consumedInitialDeepLinks = new Set<string>();

function consumeAndroidSharedText(): string | null {
  if (Platform.OS !== "android") return null;

  try {
    return consumeSharedText({
      getSharedPayloads: () => Sharing.getSharedPayloads?.() ?? [],
      clearSharedPayloads: () => Sharing.clearSharedPayloads?.(),
    });
  } catch {
    return null;
  }
}

/**
 * 消费系统分享到应用的文本（Android ACTION_SEND）。
 *
 * Android 原生侧只把 SEND intent 交给 expo-sharing 的 SharingSingleton，不会把
 * EXTRA_TEXT 拼进 deep link，因此必须读取 getSharedPayloads。读取到文本后立即
 * clearSharedPayloads，保证 ChatScreen 因会话切换重挂时不会重复导入同一份分享。
 */
export function useIncomingSharedText(onSharedText: (text: string) => void) {
  const callbackRef = useRef(onSharedText);

  useEffect(() => {
    callbackRef.current = onSharedText;
  }, [onSharedText]);

  useEffect(() => {
    let active = true;

    const deliver = (text: string | null) => {
      if (active && text) {
        callbackRef.current(text);
      }
    };
    const consumeNative = () => deliver(consumeAndroidSharedText());

    // 冷启动时原生 payload 已由 SharingSingleton 保存，先同步消费。
    consumeNative();

    void Linking.getInitialURL()
      .then((initialUrl) => {
        if (!active || !initialUrl) return;

        if (isShareIntoUrl(initialUrl)) {
          consumeNative();
          return;
        }

        deliver(takeInitialDeepLinkText(initialUrl, consumedInitialDeepLinks));
      })
      .catch(() => {});

    const linkingSubscription = Linking.addEventListener("url", (event) => {
      if (isShareIntoUrl(event.url)) {
        consumeNative();
        return;
      }
      deliver(extractSharedTextFromUrl(event.url));
    });

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        consumeNative();
      }
    });

    return () => {
      active = false;
      linkingSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);
}

export { extractSharedTextFromUrl } from "./share-payload";
