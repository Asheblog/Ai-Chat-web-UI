import * as Linking from "expo-linking";
import { useEffect } from "react";

export function extractSharedTextFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    const candidate =
      parsed.queryParams?.text ??
      parsed.queryParams?.q ??
      parsed.queryParams?.prompt ??
      parsed.queryParams?.content;

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (Array.isArray(candidate) && typeof candidate[0] === "string" && candidate[0].trim()) {
      return candidate[0].trim();
    }
    return null;
  } catch {
    return null;
  }
}

export function useIncomingSharedText(onSharedText: (text: string) => void) {
  useEffect(() => {
    let active = true;

    Linking.getInitialURL()
      .then((initialUrl) => {
        if (!active) return;
        const text = extractSharedTextFromUrl(initialUrl);
        if (text) {
          onSharedText(text);
        }
      })
      .catch(() => {});

    const subscription = Linking.addEventListener("url", (event) => {
      const text = extractSharedTextFromUrl(event.url);
      if (text) {
        onSharedText(text);
      }
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [onSharedText]);
}
