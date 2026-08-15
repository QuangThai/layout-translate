import { describe, expect, it } from "vitest";
import {
  assertAllowedPageOrigin,
  assertBearerToken,
  ContractError,
  createRateLimiter,
  MAX_BATCH_ITEMS,
  MAX_SOURCE_LENGTH,
  parseTranslationRequest,
  validateTranslationResults,
} from "../backend/src/contract";

const allowedOrigins = ["https://app.example.test"];

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    pageOrigin: "https://app.example.test",
    targetLanguage: "en",
    items: [
      {
        anchorId: "anchor-1",
        source: "会社情報",
        component: "navigation",
        dataClass: "normal",
      },
    ],
    ...overrides,
  };
}

describe("translation backend contract", () => {
  it("accepts a minimized allowlisted request", () => {
    expect(parseTranslationRequest(validRequest(), allowedOrigins)).toEqual({
      pageOrigin: "https://app.example.test",
      targetLanguage: "en",
      items: [
        {
          anchorId: "anchor-1",
          source: "会社情報",
          component: "navigation",
          dataClass: "normal",
        },
      ],
    });
  });

  it("fails closed for missing classification and protected content", () => {
    expect(() => parseTranslationRequest(
      validRequest({ items: [{ anchorId: "anchor-1", source: "会社情報", component: "navigation" }] }),
      allowedOrigins,
    )).toThrowError(ContractError);

    expect(() => parseTranslationRequest(
      validRequest({ items: [{ anchorId: "anchor-1", source: "password", component: "paragraph", dataClass: "normal" }] }),
      allowedOrigins,
    )).toThrowError(expect.objectContaining({ code: "sensitive_content_blocked", status: 422 }));
  });

  it("rejects origins outside the explicit allowlist", () => {
    expect(() => assertAllowedPageOrigin("https://other.example.test", allowedOrigins)).toThrowError(
      expect.objectContaining({ code: "origin_not_allowed", status: 403 }),
    );
  });

  it("rejects unsupported, duplicate, and oversized requests", () => {
    const item = validRequest().items[0];
    expect(() => parseTranslationRequest(validRequest({ unsupported: true }), allowedOrigins)).toThrowError(
      expect.objectContaining({ code: "invalid_request", status: 400 }),
    );
    expect(() => parseTranslationRequest(validRequest({ items: [item, item] }), allowedOrigins)).toThrowError(
      expect.objectContaining({ code: "invalid_request", status: 400 }),
    );
    expect(() => parseTranslationRequest(
      validRequest({
        items: Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, index) => ({ ...item, anchorId: `anchor-${index}` })),
      }),
      allowedOrigins,
    )).toThrowError(expect.objectContaining({ code: "invalid_request", status: 400 }));
    expect(() => parseTranslationRequest(
      validRequest({ items: [{ ...item, source: "x".repeat(MAX_SOURCE_LENGTH + 1) }] }),
      allowedOrigins,
    )).toThrowError(expect.objectContaining({ code: "invalid_request", status: 400 }));
  });

  it("fails closed for an explicitly sensitive classification", () => {
    expect(() => parseTranslationRequest(
      validRequest({ items: [{ ...validRequest().items[0], dataClass: "sensitive" }] }),
      allowedOrigins,
    )).toThrowError(expect.objectContaining({ code: "sensitive_content_blocked", status: 422 }));
  });

  it("rejects translation results that do not correlate to requested anchors", () => {
    const request = parseTranslationRequest(validRequest(), allowedOrigins);
    expect(() => validateTranslationResults(request.items, [
      { anchorId: "unknown", full: "Company", compact: "Company" },
    ])).toThrowError(expect.objectContaining({ code: "provider_invalid_response", status: 502 }));
  });

  it("requires the configured bearer token", () => {
    expect(() => assertBearerToken("Bearer wrong", "expected")).toThrowError(
      expect.objectContaining({ code: "unauthorized", status: 401 }),
    );
    expect(() => assertBearerToken("Bearer expected", "expected")).not.toThrow();
  });

  it("limits requests and validates provider correlation", () => {
    const limiter = createRateLimiter(1, 60_000);
    expect(limiter.allow("client", 100)).toBe(true);
    expect(limiter.allow("client", 101)).toBe(false);
    expect(limiter.allow("client", 60_100)).toBe(true);

    const request = parseTranslationRequest(validRequest(), allowedOrigins);
    expect(validateTranslationResults(request.items, [
      { anchorId: "anchor-1", full: "Company", compact: "Company" },
    ])).toEqual([
      { anchorId: "anchor-1", full: "Company", compact: "Company" },
    ]);
    expect(() => validateTranslationResults(request.items, [
      { anchorId: "unknown", full: "Company", compact: "Company" },
    ])).toThrowError(expect.objectContaining({ code: "provider_invalid_response", status: 502 }));
  });
});

describe("compact budget hint", () => {
  function withBudget(compactMaxChars: unknown) {
    return validRequest({
      items: [{ anchorId: "anchor-1", source: "会社情報", component: "navigation", dataClass: "normal", compactMaxChars }],
    });
  }

  it("passes a valid budget through to the provider payload", () => {
    const parsed = parseTranslationRequest(withBudget(12), allowedOrigins);
    expect(parsed.items[0]).toMatchObject({ anchorId: "anchor-1", compactMaxChars: 12 });
  });

  it("stays optional so unbudgeted regions are unchanged", () => {
    const parsed = parseTranslationRequest(validRequest(), allowedOrigins);
    expect(parsed.items[0]?.compactMaxChars).toBeUndefined();
  });

  it.each([
    ["a fraction", 12.5],
    ["zero", 0],
    ["a negative width", -5],
    ["an implausible width", 5_000],
    ["a string", "12"],
    ["null", null],
  ])("rejects %s", (_description, value) => {
    expect(() => parseTranslationRequest(withBudget(value), allowedOrigins)).toThrow(ContractError);
  });
});
