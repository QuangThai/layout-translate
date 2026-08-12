import { describe, expect, it } from "vitest";
import {
  assertAllowedPageOrigin,
  assertBearerToken,
  ContractError,
  createRateLimiter,
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
