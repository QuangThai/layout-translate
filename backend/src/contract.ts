import { MAX_TRANSLATION_BATCH_ITEMS, type ComponentKind, type TargetLanguage, type TranslationResult } from "../../src/shared/contracts";
import { isProtectedSource } from "../../src/shared/protected-content";

export const MAX_BATCH_ITEMS = MAX_TRANSLATION_BATCH_ITEMS;
export const MAX_SOURCE_LENGTH = 2_000;
export const MAX_TRANSLATION_LENGTH = 4_000;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const DEFAULT_RATE_LIMIT = 60;
export const DEFAULT_RATE_WINDOW_MS = 60_000;

const componentKinds: readonly ComponentKind[] = [
  "navigation",
  "button",
  "tab",
  "badge",
  "table",
  "form-label",
  "heading",
  "card",
  "paragraph",
  "unknown",
];

export type DataClass = "normal" | "sensitive";

export const MIN_COMPACT_MAX_CHARS = 1;
export const MAX_COMPACT_MAX_CHARS = 200;

export interface BackendTranslationItem {
  anchorId: string;
  source: string;
  component: ComponentKind;
  dataClass: DataClass;
  /** Characters the compact variant may use before the source box overflows. */
  compactMaxChars?: number;
}

export interface BackendTranslationRequest {
  pageOrigin: string;
  targetLanguage: TargetLanguage;
  items: BackendTranslationItem[];
}

export type ContractErrorCode =
  | "invalid_request"
  | "origin_not_allowed"
  | "sensitive_content_blocked"
  | "request_too_large"
  | "rate_limited"
  | "unauthorized"
  | "provider_invalid_response"
  | "provider_refused"
  | "provider_rate_limited"
  | "provider_unavailable";

export class ContractError extends Error {
  constructor(
    readonly code: ContractErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new ContractError("invalid_request", 400, `${label} contains unsupported field: ${key}`);
    }
  }
}

function assertString(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new ContractError("invalid_request", 400, `${label} must be a non-empty string of at most ${maxLength} characters`);
  }
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const origins = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const normalized = origins.map((origin) => {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ContractError("invalid_request", 500, `Invalid configured origin: ${origin}`);
    }
    if (
      !/^https?:$/u.test(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      throw new ContractError("invalid_request", 500, `Configured origin must be an HTTP(S) origin: ${origin}`);
    }
    return parsed.origin;
  });
  return [...new Set(normalized)];
}

export function assertAllowedPageOrigin(pageOrigin: string, allowedOrigins: readonly string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(pageOrigin);
  } catch {
    throw new ContractError("origin_not_allowed", 403, "Page origin is not allowed");
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.origin !== pageOrigin || !allowedOrigins.includes(parsed.origin)) {
    throw new ContractError("origin_not_allowed", 403, "Page origin is not allowed");
  }
}

export function parseTranslationRequest(value: unknown, allowedOrigins: readonly string[]): BackendTranslationRequest {
  if (!isRecord(value)) throw new ContractError("invalid_request", 400, "Request body must be an object");
  assertExactKeys(value, ["pageOrigin", "targetLanguage", "items"], "request");
  assertString(value.pageOrigin, "pageOrigin", 2_048);
  assertAllowedPageOrigin(value.pageOrigin, allowedOrigins);
  if (value.targetLanguage !== "en" && value.targetLanguage !== "vi") {
    throw new ContractError("invalid_request", 400, "targetLanguage must be en or vi");
  }
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > MAX_BATCH_ITEMS) {
    throw new ContractError("invalid_request", 400, `items must contain 1-${MAX_BATCH_ITEMS} entries`);
  }

  const seenAnchorIds = new Set<string>();
  const items = value.items.map((item, index): BackendTranslationItem => {
    if (!isRecord(item)) throw new ContractError("invalid_request", 400, `items[${index}] must be an object`);
    assertExactKeys(item, ["anchorId", "source", "component", "dataClass", "compactMaxChars"], `items[${index}]`);
    assertString(item.anchorId, `items[${index}].anchorId`, 128);
    if (!/^[A-Za-z0-9_-]+$/u.test(item.anchorId)) {
      throw new ContractError("invalid_request", 400, `items[${index}].anchorId has invalid characters`);
    }
    if (seenAnchorIds.has(item.anchorId)) {
      throw new ContractError("invalid_request", 400, `items[${index}].anchorId is duplicated`);
    }
    seenAnchorIds.add(item.anchorId);
    assertString(item.source, `items[${index}].source`, MAX_SOURCE_LENGTH);
    if (typeof item.component !== "string" || !componentKinds.includes(item.component as ComponentKind)) {
      throw new ContractError("invalid_request", 400, `items[${index}].component is invalid`);
    }
    if (item.dataClass !== "normal" && item.dataClass !== "sensitive") {
      throw new ContractError("invalid_request", 400, `items[${index}].dataClass must be normal or sensitive`);
    }
    if (item.dataClass === "sensitive" || isProtectedSource(item.source)) {
      throw new ContractError("sensitive_content_blocked", 422, `items[${index}] contains protected content`);
    }
    // A layout hint, so it is bounded like every other field rather than
    // trusted from the page context that produced it.
    if (item.compactMaxChars !== undefined && (
      typeof item.compactMaxChars !== "number"
      || !Number.isInteger(item.compactMaxChars)
      || item.compactMaxChars < MIN_COMPACT_MAX_CHARS
      || item.compactMaxChars > MAX_COMPACT_MAX_CHARS
    )) {
      throw new ContractError(
        "invalid_request",
        400,
        `items[${index}].compactMaxChars must be an integer between ${MIN_COMPACT_MAX_CHARS} and ${MAX_COMPACT_MAX_CHARS}`,
      );
    }

    return {
      anchorId: item.anchorId,
      source: item.source,
      component: item.component as ComponentKind,
      dataClass: "normal",
      ...(item.compactMaxChars === undefined ? {} : { compactMaxChars: item.compactMaxChars }),
    };
  });

  return {
    pageOrigin: value.pageOrigin,
    targetLanguage: value.targetLanguage,
    items,
  };
}

export function assertBearerToken(authorization: string | undefined, expectedToken: string | undefined): void {
  if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
    throw new ContractError("unauthorized", 401, "Valid backend authorization is required");
  }
}

export function validateTranslationResults(
  items: readonly BackendTranslationItem[],
  results: unknown,
): TranslationResult[] {
  if (!Array.isArray(results) || results.length !== items.length) {
    throw new ContractError("provider_invalid_response", 502, "Provider response count does not match the request");
  }
  const requestedIds = new Set(items.map((item) => item.anchorId));
  const returnedIds = new Set<string>();
  return results.map((result, index) => {
    if (!isRecord(result)) {
      throw new ContractError("provider_invalid_response", 502, `Provider result ${index} is not an object`);
    }
    if (typeof result.anchorId !== "string" || !requestedIds.has(result.anchorId) || returnedIds.has(result.anchorId)) {
      throw new ContractError("provider_invalid_response", 502, `Provider result ${index} has an invalid anchorId`);
    }
    assertString(result.full, `provider result ${index}.full`, MAX_TRANSLATION_LENGTH);
    assertString(result.compact, `provider result ${index}.compact`, MAX_TRANSLATION_LENGTH);
    returnedIds.add(result.anchorId);
    return {
      anchorId: result.anchorId,
      full: result.full,
      compact: result.compact,
    };
  });
}

export interface RateLimiter {
  allow(key: string, now?: number): boolean;
}

export function createRateLimiter(
  limit = DEFAULT_RATE_LIMIT,
  windowMs = DEFAULT_RATE_WINDOW_MS,
): RateLimiter {
  const buckets = new Map<string, { startedAt: number; count: number }>();
  return {
    allow(key, now = Date.now()): boolean {
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.startedAt >= windowMs) {
        buckets.set(key, { startedAt: now, count: 1 });
        return true;
      }
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    },
  };
}
