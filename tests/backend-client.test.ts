import { describe, expect, it } from "vitest";
import { REQUEST_TIMEOUT_MS, translateViaBackend } from "../src/shared/backend-client";

const request = [{ anchorId: "anchor-1", source: "会社情報", component: "navigation" as const }];
const config = { url: "http://127.0.0.1:8787", token: "token" };

function response(body: unknown, ok = true, status = 200, requestId?: string): Response {
  const result = new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
  });
  Object.defineProperty(result, "ok", { value: ok });
  return result;
}

describe("backend translation client", () => {
  it("forwards a compact budget only for the items that carry one", async () => {
    let captured: RequestInit | undefined;
    await translateViaBackend(
      config,
      "http://127.0.0.1:4173",
      [
        { anchorId: "anchor-1", source: "会社情報", component: "navigation", compactMaxChars: 9 },
        { anchorId: "anchor-2", source: "長い説明テキストです。", component: "paragraph" },
      ],
      "en",
      async (_url, init) => {
        captured = init;
        return response({
          translations: [
            { anchorId: "anchor-1", full: "Company", compact: "Company" },
            { anchorId: "anchor-2", full: "Long text", compact: "Long" },
          ],
        });
      },
    );

    const body = JSON.parse(String(captured?.body));
    expect(body.items[0]).toEqual({
      anchorId: "anchor-1",
      source: "会社情報",
      component: "navigation",
      dataClass: "normal",
      compactMaxChars: 9,
    });
    expect(body.items[1]).not.toHaveProperty("compactMaxChars");
  });

  it("sends minimized requests and validates correlated results", async () => {
    let captured: RequestInit | undefined;
    const result = await translateViaBackend(config, "http://127.0.0.1:4173", request, "en", async (_url, init) => {
      captured = init;
      return response({ translations: [{ anchorId: "anchor-1", full: "Company", compact: "Company" }] });
    });
    expect(result).toEqual([{ anchorId: "anchor-1", full: "Company", compact: "Company" }]);
    expect(JSON.parse(String(captured?.body))).toEqual({
      pageOrigin: "http://127.0.0.1:4173",
      targetLanguage: "en",
      items: [{ anchorId: "anchor-1", source: "会社情報", component: "navigation", dataClass: "normal" }],
    });
    expect((captured?.headers as Record<string, string>).authorization).toBe("Bearer token");
  });

  it("fails closed for incomplete, rejected, and timed-out responses", async () => {
    await expect(translateViaBackend(config, "http://127.0.0.1:4173", request, "en", async () =>
      response({ translations: [] }),
    )).rejects.toThrow("incomplete");
      await expect(translateViaBackend(config, "http://127.0.0.1:4173", request, "en", async () =>
        response({ code: "unauthorized" }, false, 401, "request-unauthorized"),
      )).rejects.toThrow("unauthorized [request_id:request-unauthorized]");
    await expect(translateViaBackend(config, "http://127.0.0.1:4173", request, "en", async (_url, init) => {
      await new Promise((_, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
      throw new Error("unreachable");
    }, 20)).rejects.toThrow("timed out");
  });
});
