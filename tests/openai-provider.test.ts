import { describe, expect, it } from "vitest";
import { ContractError } from "../backend/src/contract";
import {
  createOpenAIProvider,
  DEFAULT_OPENAI_BASE_URL,
  readOpenAIProviderConfig,
} from "../backend/src/openai-provider";

const config = {
  apiKey: "test-key",
  model: "test-model",
  baseUrl: DEFAULT_OPENAI_BASE_URL,
  timeoutMs: 1_000,
};

const items = [
  { anchorId: "anchor-1", source: "会社情報", component: "navigation" as const, dataClass: "normal" as const },
  { anchorId: "anchor-2", source: "保存する", component: "button" as const, dataClass: "normal" as const },
];

function completion(payload: unknown, ok = true, status = 200): Response {
  const result = new Response(JSON.stringify(payload), { status });
  Object.defineProperty(result, "ok", { value: ok });
  return result;
}

function structured(translations: unknown): Response {
  return completion({ choices: [{ message: { content: JSON.stringify({ translations }) } }] });
}

describe("openai provider configuration", () => {
  it("fails closed without a key or model", () => {
    expect(() => readOpenAIProviderConfig({ LAYOUT_TRANSLATE_PROVIDER_MODEL: "m" })).toThrow(/OPENAI_API_KEY/u);
    expect(() => readOpenAIProviderConfig({ OPENAI_API_KEY: "k" })).toThrow(/PROVIDER_MODEL/u);
  });

  it("assumes no default model and rejects non-HTTP base URLs", () => {
    const parsed = readOpenAIProviderConfig({ OPENAI_API_KEY: "k", LAYOUT_TRANSLATE_PROVIDER_MODEL: "m" });
    expect(parsed).toMatchObject({ model: "m", baseUrl: DEFAULT_OPENAI_BASE_URL });
    expect(() => readOpenAIProviderConfig({
      OPENAI_API_KEY: "k",
      LAYOUT_TRANSLATE_PROVIDER_MODEL: "m",
      LAYOUT_TRANSLATE_PROVIDER_BASE_URL: "ftp://example.com",
    })).toThrow(/HTTP/u);
  });
});

describe("openai provider requests", () => {
  it("sends only contract fields and keeps the key in the header", async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const provider = createOpenAIProvider(config, async (url, init) => {
      captured = { url: String(url), init };
      return structured([
        { anchorId: "anchor-1", full: "Company", compact: "Company" },
        { anchorId: "anchor-2", full: "Save", compact: "Save" },
      ]);
    });

    const results = await provider.translateBatch(items, "en");
    expect(results).toEqual([
      { anchorId: "anchor-1", full: "Company", compact: "Company" },
      { anchorId: "anchor-2", full: "Save", compact: "Save" },
    ]);

    expect(captured?.url).toBe(`${DEFAULT_OPENAI_BASE_URL}/chat/completions`);
    const headers = captured?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");

    const body = JSON.parse(String(captured?.init?.body));
    expect(body.model).toBe("test-model");
    expect(body.response_format.json_schema.strict).toBe(true);
    const userContent = body.messages.at(-1).content as string;
    expect(userContent).toContain("会社情報");
    expect(userContent).not.toContain("dataClass");
  });

  it("tells the provider how much room a constrained control has", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = createOpenAIProvider(config, async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return structured([
        { anchorId: "anchor-1", full: "Company Information", compact: "Company" },
        { anchorId: "anchor-2", full: "Save", compact: "Save" },
      ]);
    });

    await provider.translateBatch([{ ...items[0]!, compactMaxChars: 8 }, items[1]!], "en");

    const systemPrompt = String((body?.messages as Array<{ content: string }>)[0]?.content);
    expect(systemPrompt).toContain("compactMaxChars");
    const userContent = String((body?.messages as Array<{ content: string }>).at(-1)?.content);
    const payload = JSON.parse(userContent.slice(userContent.indexOf("{")));
    expect(payload.items[0]).toMatchObject({ anchorId: "anchor-1", compactMaxChars: 8 });
    expect(payload.items[1].compactMaxChars).toBeUndefined();
  });

  it("maps provider failures to contract errors without echoing content", async () => {
    const rateLimited = createOpenAIProvider(config, async () =>
      completion({ error: { code: "rate_limit_exceeded", message: "会社情報 was too long" } }, false, 429));
    await expect(rateLimited.translateBatch(items, "en")).rejects.toMatchObject({
      code: "provider_rate_limited",
      status: 502,
    });
    await expect(rateLimited.translateBatch(items, "en")).rejects.toThrow(/^(?!.*会社情報).*$/u);

    const unavailable = createOpenAIProvider(config, async () => completion({}, false, 500));
    await expect(unavailable.translateBatch(items, "en")).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("rejects refusals and malformed structured output", async () => {
    const refused = createOpenAIProvider(config, async () =>
      completion({ choices: [{ message: { refusal: "I cannot help with that" } }] }));
    await expect(refused.translateBatch(items, "en")).rejects.toMatchObject({ code: "provider_refused" });

    const notJson = createOpenAIProvider(config, async () =>
      completion({ choices: [{ message: { content: "Company" } }] }));
    await expect(notJson.translateBatch(items, "en")).rejects.toMatchObject({ code: "provider_invalid_response" });

    const missingField = createOpenAIProvider(config, async () =>
      structured([{ anchorId: "anchor-1", full: "Company" }]));
    await expect(missingField.translateBatch(items, "en")).rejects.toBeInstanceOf(ContractError);
  });

  it("times out instead of hanging the batch", async () => {
    const provider = createOpenAIProvider({ ...config, timeoutMs: 10 }, (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }));
    await expect(provider.translateBatch(items, "en")).rejects.toMatchObject({
      code: "provider_unavailable",
      message: "Provider request timed out",
    });
  });
});
