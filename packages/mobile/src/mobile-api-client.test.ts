import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileApiClient, UnauthorizedApiError } from "./mobile-api-client";

describe("MobileApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("自动附加 Bearer token 并支持切换模型与个人设置", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: 7, title: "新标题" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new MobileApiClient({
      endpoint: "https://chat.example.com/",
      getToken: () => "jwt-token-123",
    });

    const updated = await client.switchSessionModel(7, {
      modelId: "deepseek/deepseek-r1",
      rawId: "deepseek-r1",
      connectionId: 2,
    });

    expect(updated).toEqual({ id: 7, title: "新标题" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chat.example.com/api/sessions/7/model",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer jwt-token-123",
        }),
      }),
    );
  });

  it("返回 401 时触发 onUnauthorized 回调并抛出 UnauthorizedApiError", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, error: "Token expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const client = new MobileApiClient({
      endpoint: "https://chat.example.com",
      getToken: () => "bad-token",
      onUnauthorized,
    });

    await expect(client.getKnowledgeBases()).rejects.toBeInstanceOf(UnauthorizedApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
