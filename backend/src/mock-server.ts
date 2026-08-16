import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mockTranslateBatch, type MockTranslationEntry } from "../../src/shared/mock-translation";
import {
  assertBearerToken,
  ContractError,
  createRateLimiter,
  MAX_REQUEST_BYTES,
  parseAllowedOrigins,
  parseTranslationRequest,
  validateTranslationResults,
} from "./contract";
import { createOpenAIProvider, readOpenAIProviderConfig, type TranslationProvider } from "./openai-provider";
import { createIdentityVerifier, IdentityError, readIdentityConfig, type VerifiedIdentity } from "./identity";
import { createQuotaLedger, readQuotaConfig } from "./quota";

const port = Number(process.env.LAYOUT_TRANSLATE_MOCK_PORT ?? 8787);
// Loopback by default so a development run is not exposed; a container sets this.
const host = process.env.LAYOUT_TRANSLATE_BIND_HOST ?? "127.0.0.1";
const authToken = process.env.LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN;
const allowedPageOrigins = parseAllowedOrigins(process.env.LAYOUT_TRANSLATE_ALLOWED_ORIGINS);
const allowedClientOrigins = parseAllowedOrigins(process.env.LAYOUT_TRANSLATE_ALLOWED_CLIENT_ORIGINS);
const allowExtensionClients = process.env.LAYOUT_TRANSLATE_ALLOW_EXTENSION_CLIENTS === "true";
let activeFailureMode = process.env.LAYOUT_TRANSLATE_MOCK_FAILURE_MODE ?? "none";
// Counts requests seen in flaky mode so the first one fails and the retry works.
let flakyRequests = 0;
const allowTestFailureMode = process.env.LAYOUT_TRANSLATE_ALLOW_TEST_FAILURE_MODE === "true";
const rateLimit = Number(process.env.LAYOUT_TRANSLATE_RATE_LIMIT ?? 60);
const limiter = createRateLimiter(Number.isFinite(rateLimit) && rateLimit > 0 ? rateLimit : 60);
const translationOverridesPath = process.env.LAYOUT_TRANSLATE_MOCK_TRANSLATION_OVERRIDES;

// Who the caller is has to be a deliberate choice, not a default. A shared
// token cannot attribute a quota, trace an abuse, or revoke one person, so
// running that way in production must be something someone typed.
const authMode = process.env.LAYOUT_TRANSLATE_AUTH_MODE ?? "shared-token";
if (authMode !== "shared-token" && authMode !== "identity") {
  throw new Error("LAYOUT_TRANSLATE_AUTH_MODE must be shared-token or identity");
}
const verifyIdentity = authMode === "identity" ? createIdentityVerifier(readIdentityConfig()) : null;
const quota = createQuotaLedger(readQuotaConfig());

function loadTranslationOverrides(path: string | undefined): Record<string, MockTranslationEntry> {
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("LAYOUT_TRANSLATE_MOCK_TRANSLATION_OVERRIDES must point to valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("LAYOUT_TRANSLATE_MOCK_TRANSLATION_OVERRIDES must contain an object map");
  }
  const overrides: Record<string, MockTranslationEntry> = {};
  for (const [source, value] of Object.entries(parsed)) {
    if (
      !source
      || typeof value !== "object"
      || value === null
      || Array.isArray(value)
      || typeof (value as { en?: unknown }).en !== "string"
      || typeof (value as { vi?: unknown }).vi !== "string"
      || !(value as { en: string }).en
      || !(value as { vi: string }).vi
    ) {
      throw new Error("LAYOUT_TRANSLATE_MOCK_TRANSLATION_OVERRIDES contains an invalid translation entry");
    }
    const compact = (value as { compact?: unknown }).compact;
    if (compact !== undefined && (
      typeof compact !== "object"
      || compact === null
      || Array.isArray(compact)
      || (compact as { en?: unknown }).en !== undefined && typeof (compact as { en?: unknown }).en !== "string"
      || (compact as { vi?: unknown }).vi !== undefined && typeof (compact as { vi?: unknown }).vi !== "string"
    )) {
      throw new Error("LAYOUT_TRANSLATE_MOCK_TRANSLATION_OVERRIDES contains an invalid compact entry");
    }
    overrides[source] = value as MockTranslationEntry;
  }
  return overrides;
}

const translationOverrides = loadTranslationOverrides(translationOverridesPath);

// The default remains the offline dictionary. A real provider is opt-in, keeps
// its credentials server-side, and fails closed when its configuration is
// incomplete rather than silently degrading to mock output.
const providerMode = process.env.LAYOUT_TRANSLATE_PROVIDER ?? "mock";
if (providerMode !== "mock" && providerMode !== "openai") {
  throw new Error("LAYOUT_TRANSLATE_PROVIDER must be mock or openai");
}
// Set for the duration of a request so provider usage is charged to the account
// that caused it. The server handles one request at a time per call stack.
let chargeAccount: string | null = null;
const provider: TranslationProvider | null = providerMode === "openai"
  ? createOpenAIProvider(readOpenAIProviderConfig(), fetch, (usage) => {
    const tokens = usage.promptTokens + usage.completionTokens;
    if (chargeAccount) quota.record(chargeAccount, tokens);
    // Counts only, never content: a cost estimate and a quota need nothing else.
    console.log(JSON.stringify({ event: "provider_usage", ...usage, account: chargeAccount }));
  })
  : null;

if (authMode === "shared-token" && !authToken) {
  throw new Error("LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN must be configured before starting in shared-token mode");
}
if (allowedPageOrigins.length === 0) {
  throw new Error("LAYOUT_TRANSLATE_ALLOWED_ORIGINS must contain at least one HTTP(S) origin");
}

function isAllowedClientOrigin(origin: string | undefined): boolean {
  return Boolean(origin && (allowedClientOrigins.includes(origin) || (allowExtensionClients && /^chrome-extension:\/\//u.test(origin))));
}

function corsHeaders(request: IncomingMessage): Record<string, string> {
  const origin = request.headers.origin;
  if (!isAllowedClientOrigin(origin)) return {};
  return {
    "access-control-allow-origin": origin!,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
}

function writeJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
  requestId: string,
  // How many strings this response covered. A count is not content, and without
  // it there is no way to see a page paying for the same text twice.
  itemCount?: number,
  account?: string,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    ...corsHeaders(request),
  });
  response.end(JSON.stringify(body));
  console.log(JSON.stringify({
    event: "translation_response",
    requestId,
    method: request.method,
    path: request.url,
    status,
    ...(itemCount === undefined ? {} : { itemCount }),
    ...(account === undefined ? {} : { account }),
  }));
}

function sendError(request: IncomingMessage, response: ServerResponse, error: unknown, requestId: string): void {
  if (error instanceof ContractError) {
    writeJson(request, response, error.status, { code: error.code, error: error.message }, requestId);
    return;
  }
  writeJson(request, response, 500, { code: "internal_error", error: "Translation request failed" }, requestId);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  let bytes = 0;
  request.setEncoding("utf8");
  for await (const chunk of request) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > MAX_REQUEST_BYTES) {
      throw new ContractError("request_too_large", 413, `Request body exceeds ${MAX_REQUEST_BYTES} bytes`);
    }
    raw += text;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ContractError("invalid_request", 400, "Invalid JSON request");
  }
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  const requestOrigin = request.headers.origin;
  if (requestOrigin && !isAllowedClientOrigin(requestOrigin)) {
    writeJson(request, response, 403, { code: "origin_not_allowed", error: "Client origin is not allowed" }, requestId);
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, { "x-request-id": requestId, ...corsHeaders(request) });
    response.end();
    console.log(JSON.stringify({
      event: "translation_response",
      requestId,
      method: request.method,
      path: request.url,
      status: 204,
    }));
    return;
  }

  if (allowTestFailureMode && request.method === "POST" && request.url === "/__test/failure-mode") {
    let raw = "";
    request.setEncoding("utf8");
    for await (const chunk of request) raw += chunk;
    const requestedMode = JSON.parse(raw).mode;
    if (!["none", "reject-422", "malformed-502", "timeout", "delay-success", "flaky-503"].includes(requestedMode)) {
      writeJson(request, response, 400, { code: "invalid_request", error: "Unsupported test failure mode" }, requestId);
      return;
    }
    activeFailureMode = requestedMode;
    flakyRequests = 0;
    writeJson(request, response, 204, {}, requestId);
    return;
  }

  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "ok", authMode, provider: provider?.name ?? "mock" }));
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/translate") {
    writeJson(request, response, 404, { code: "not_found", error: "Not found" }, requestId);
    return;
  }

  let identity: VerifiedIdentity | null = null;
  try {
    if (verifyIdentity) {
      try {
        identity = await verifyIdentity(request.headers.authorization);
      } catch (error) {
        const code = error instanceof IdentityError ? error.code : "unauthorized";
        throw new ContractError(
          code === "identity_unavailable" ? "provider_unavailable" : "unauthorized",
          code === "identity_unavailable" ? 502 : 401,
          error instanceof Error ? error.message : "Identity could not be verified",
        );
      }
    } else {
      assertBearerToken(request.headers.authorization, authToken);
    }

    const clientKey = request.socket.remoteAddress ?? "unknown";
    if (!limiter.allow(clientKey)) {
      throw new ContractError("rate_limited", 429, "Translation rate limit exceeded");
    }
    // Charged to the person, not the address: several people behind one office
    // address are not one caller, and one person on two networks is not two.
    const account = identity?.email ?? identity?.subject ?? clientKey;
    const allowance = quota.check(account);
    if (!allowance.allowed) {
      throw new ContractError(
        "rate_limited",
        429,
        allowance.reason === "daily_token_limit"
          ? `Daily translation budget of ${allowance.limitTokens} tokens is spent`
          : "Too many translation requests from this account",
      );
    }
    const body = await readBody(request);
    const parsed = parseTranslationRequest(body, allowedPageOrigins);
    if (activeFailureMode === "reject-422") {
      throw new ContractError("sensitive_content_blocked", 422, "Synthetic failure mode rejected the batch");
    }
    if (activeFailureMode === "malformed-502") {
      writeJson(request, response, 502, { code: "provider_invalid_response", error: "Synthetic malformed provider response" }, requestId);
      return;
    }
    // Fails the first request of each batch and answers the retry, which is the
    // shape of a transient provider problem.
    if (activeFailureMode === "flaky-503") {
      flakyRequests += 1;
      if (flakyRequests % 2 === 1) {
        writeJson(request, response, 503, { code: "provider_unavailable", error: "Synthetic transient failure" }, requestId);
        return;
      }
    }
    if (activeFailureMode === "timeout") await sleep(15_000);
    if (activeFailureMode === "delay-success") await sleep(350);
    // Keep the provider payload limited to the contract fields; no source-page
    // metadata or extension-owned fields are forwarded implicitly.
      chargeAccount = account;
      const providerResults = provider
        ? await provider.translateBatch(parsed.items, parsed.targetLanguage)
        : await mockTranslateBatch(
          parsed.items.map(({ anchorId, source, component }) => ({ anchorId, source, component })),
          parsed.targetLanguage,
        );
      // Deterministic overrides are a fixture-replay hook, so they must never
      // rewrite what a real provider returned.
      const overriddenResults = provider
        ? providerResults
        : providerResults.map((result, index) => {
          const item = parsed.items[index];
          if (!item) return result;
          const override = translationOverrides[item.source];
          if (!override) return result;
          const full = override[parsed.targetLanguage];
          if (typeof full !== "string" || full.length === 0) return result;
          return {
            ...result,
            full,
            compact: override.compact?.[parsed.targetLanguage] ?? full,
          };
        });
      const translations = validateTranslationResults(parsed.items, overriddenResults);
    writeJson(request, response, 200, { translations }, requestId, translations.length, account);
  } catch (error) {
    sendError(request, response, error, requestId);
  }
});

// A container is told to stop before it is killed; finishing the requests in
// flight avoids charging for provider calls whose answers are thrown away.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(JSON.stringify({ event: "backend_stopping", signal }));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

server.listen(port, host, () => {
  console.log(`Layout Translate backend listening on http://${host}:${port}`);
  // Never log page content or credentials; the provider mode and model name are
  // configuration, not translated material.
  console.log(JSON.stringify({
    event: "backend_started",
    provider: provider?.name ?? "mock",
    model: provider?.model ?? null,
    authMode,
    allowedPageOrigins,
  }));
});
