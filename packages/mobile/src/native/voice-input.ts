import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

type OptionalSpeechRecognitionModule = {
  requestPermissionsAsync?: () => Promise<{ granted: boolean }>;
  start?: (options: { lang?: string; interimResults?: boolean }) => void;
  stop?: () => void;
  addListener?: (
    event: string,
    listener: (payload: { results?: Array<{ transcript?: string }>; error?: string }) => void,
  ) => { remove: () => void };
};

function resolveOptionalSpeechModule(): OptionalSpeechRecognitionModule | null {
  // 通过运行时检测可选原生模块，确保无额外原生依赖时也能稳定编译和降级提示。
  try {
    const globalObj = globalThis as unknown as {
      __AICHAT_SPEECH_RECOGNITION__?: OptionalSpeechRecognitionModule;
    };
    if (globalObj.__AICHAT_SPEECH_RECOGNITION__) {
      return globalObj.__AICHAT_SPEECH_RECOGNITION__;
    }
  } catch {}
  return null;
}

export function useVoiceInput({
  locale = "zh-CN",
  onTranscript,
  onUnavailable,
  onError,
}: {
  locale?: string;
  onTranscript: (text: string) => void;
  onUnavailable?: (hint: string) => void;
  onError?: (message: string) => void;
}) {
  const [isListening, setIsListening] = useState(false);
  const subRef = useRef<{ remove: () => void } | null>(null);
  const moduleRef = useRef<OptionalSpeechRecognitionModule | null>(resolveOptionalSpeechModule());
  const isSupported = Boolean(moduleRef.current?.start);

  useEffect(() => {
    return () => {
      subRef.current?.remove();
      subRef.current = null;
      try {
        moduleRef.current?.stop?.();
      } catch {}
    };
  }, []);

  const stopListening = useCallback(() => {
    subRef.current?.remove();
    subRef.current = null;
    try {
      moduleRef.current?.stop?.();
    } catch {}
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(async () => {
    const mod = moduleRef.current;
    if (!mod || typeof mod.start !== "function") {
      const keyboardHint =
        Platform.OS === "ios"
          ? "当前免签名构建未内嵌离线语音引擎，可直接点击系统键盘右下角麦克风进行听写。"
          : "当前包未内嵌语音识别引擎，可使用输入法键盘上的麦克风语音输入。";
      onUnavailable?.(keyboardHint);
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    try {
      if (mod.requestPermissionsAsync) {
        const perm = await mod.requestPermissionsAsync();
        if (!perm.granted) {
          onError?.("未获得麦克风或语音识别权限。");
          return;
        }
      }

      if (mod.addListener) {
        subRef.current = mod.addListener("result", (event) => {
          const text = event?.results?.[0]?.transcript?.trim();
          if (text) {
            onTranscript(text);
          }
        });
      }

      setIsListening(true);
      mod.start({ lang: locale, interimResults: false });
    } catch (error) {
      setIsListening(false);
      onError?.(error instanceof Error ? error.message : "语音识别启动失败。");
    }
  }, [isListening, locale, onError, onTranscript, onUnavailable, stopListening]);

  return {
    isSupported,
    isListening,
    toggleListening,
    stopListening,
  };
}
