import { describe, expect, it } from "vitest";
import {
  isRetryableFailure,
  MAX_TRANSLATION_ATTEMPTS,
  maxAttemptsFor,
  RETRY_BASE_DELAY_MS,
  retryDelayMs,
} from "../src/shared/retry";

describe("translation retry policy", () => {
  it("tries again for failures that may not happen twice", () => {
    for (const code of [
      "rate_limited",
      "provider_rate_limited",
      "provider_unavailable",
      "provider_invalid_response",
      "provider_refused",
      "internal_error",
      "network_error",
      "timeout",
    ]) {
      expect(isRetryableFailure(code), code).toBe(true);
    }
  });

  it("never retries a refusal", () => {
    // Retrying these would re-send content the boundary already rejected, or
    // repeat a request that is wrong in a way another attempt cannot fix.
    for (const code of [
      "unauthorized",
      "origin_not_allowed",
      "sensitive_content_blocked",
      "invalid_request",
      "request_too_large",
      "not_found",
      "backend_not_configured",
    ]) {
      expect(isRetryableFailure(code), code).toBe(false);
    }
  });

  it("treats an unknown or missing code as not retryable", () => {
    expect(isRetryableFailure(undefined)).toBe(false);
    expect(isRetryableFailure("")).toBe(false);
    expect(isRetryableFailure("something_new")).toBe(false);
  });

  it("backs off so a struggling provider is not hammered by every batch", () => {
    expect(retryDelayMs(1)).toBe(RETRY_BASE_DELAY_MS);
    expect(retryDelayMs(2)).toBe(RETRY_BASE_DELAY_MS * 2);
    expect(retryDelayMs(3)).toBe(RETRY_BASE_DELAY_MS * 4);
    expect(retryDelayMs(0)).toBe(RETRY_BASE_DELAY_MS);
  });

  it("spends fewer attempts on a timeout than on a fast failure", () => {
    // A timeout already cost the reader the full wait once, so a third attempt
    // only doubles how long they wait before being told it failed.
    expect(maxAttemptsFor("timeout")).toBe(2);
    expect(maxAttemptsFor("provider_unavailable")).toBe(MAX_TRANSLATION_ATTEMPTS);
    expect(maxAttemptsFor("unauthorized")).toBe(1);
    expect(maxAttemptsFor(undefined)).toBe(1);
  });

  it("bounds the attempts so a failing page still settles", () => {
    expect(MAX_TRANSLATION_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_TRANSLATION_ATTEMPTS).toBeLessThanOrEqual(4);
  });
});
