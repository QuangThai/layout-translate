/**
 * Which translation failures are worth trying again.
 *
 * A page is translated in many batches, so on a real site the chance that at
 * least one of them hits a transient provider or network problem is high. With
 * no retry, one of those discards the whole pass and the reader sees nothing
 * translated. Retrying a permanent refusal, on the other hand, only wastes the
 * reader's time and the provider's quota, and would keep re-sending content the
 * boundary already rejected.
 */
const RETRYABLE_CODES = new Set([
  "rate_limited",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_invalid_response",
  "provider_refused",
  "internal_error",
  "network_error",
  "timeout",
]);

/** Refusals that mean the request itself is wrong and will stay wrong. */
const PERMANENT_CODES = new Set([
  "unauthorized",
  "origin_not_allowed",
  "sensitive_content_blocked",
  "invalid_request",
  "request_too_large",
  "not_found",
  "backend_not_configured",
]);

export const MAX_TRANSLATION_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 400;

/**
 * How many times a batch may be sent for a given failure.
 *
 * A timeout has already cost the reader the full wait once. A second attempt is
 * worth making; a third only doubles how long they wait before being told it
 * failed, so timeouts get fewer attempts than a fast refusal like a 503.
 */
export function maxAttemptsFor(code: string | undefined): number {
  if (!isRetryableFailure(code)) return 1;
  if (code === "timeout") return 2;
  return MAX_TRANSLATION_ATTEMPTS;
}

export function isRetryableFailure(code: string | undefined): boolean {
  if (!code) return false;
  if (PERMANENT_CODES.has(code)) return false;
  return RETRYABLE_CODES.has(code);
}

/**
 * Grows the wait between attempts so a provider that is rate limiting or
 * briefly unavailable is not hammered by every batch at once.
 */
export function retryDelayMs(attempt: number, baseDelayMs = RETRY_BASE_DELAY_MS): number {
  return baseDelayMs * 2 ** Math.max(0, attempt - 1);
}
