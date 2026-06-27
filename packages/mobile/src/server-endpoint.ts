const HEALTH_PATH = "/api/settings/health";
const HEALTH_CHECK_TIMEOUT_MS = 8000;

export type EndpointValidationResult =
  | { ok: true; endpoint: string }
  | { ok: false; message: string };

export type HealthCheckResult =
  | { ok: true; endpoint: string }
  | { ok: false; message: string };

type HealthResponse = {
  success?: boolean;
  error?: string;
  data?: {
    status?: string;
  };
};

export function normalizeServerEndpoint(input: string): EndpointValidationResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, message: "请输入 AIChat 服务端地址。" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: "地址格式不正确，请输入完整的 http:// 或 https:// 地址。" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "服务端地址只支持 http:// 或 https://。" };
  }

  if (!parsed.hostname) {
    return { ok: false, message: "服务端地址缺少主机名。" };
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";

  return {
    ok: true,
    endpoint: parsed.toString().replace(/\/+$/, ""),
  };
}

export function buildHealthCheckUrl(endpoint: string) {
  return `${endpoint}${HEALTH_PATH}`;
}

export async function checkServerHealth(endpoint: string): Promise<HealthCheckResult> {
  const validation = normalizeServerEndpoint(endpoint);

  if (!validation.ok) {
    return validation;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(buildHealthCheckUrl(validation.endpoint), {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    let body: HealthResponse | null = null;

    try {
      body = (await response.json()) as HealthResponse;
    } catch {
      body = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        message: body?.error ?? `连接失败，服务端返回 ${response.status}。`,
      };
    }

    if (body?.success !== true) {
      return {
        ok: false,
        message: body?.error ?? "服务端响应无法确认健康状态。",
      };
    }

    return { ok: true, endpoint: validation.endpoint };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";

    return {
      ok: false,
      message: isAbort
        ? "连接超时，请确认服务端地址和网络。"
        : "无法连接服务端，请确认地址、端口和网络可达。",
    };
  } finally {
    clearTimeout(timeout);
  }
}
