import type {
  BackendConfig,
  TargetLanguage,
  TranslationRequest,
  TranslationResult,
} from "./contracts";

const MAX_TRANSLATION_LENGTH = 4_000;
export const REQUEST_TIMEOUT_MS = 10_000;

function assertValidConfig(config: BackendConfig): URL {
  if (!config.url || !config.token) throw new Error("Translation backend is not configured");
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error("Translation backend URL is invalid");
  }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Translation backend URL is invalid");
  }
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/v1/translate`;
  return url;
}

function parseResults(value: unknown, requested: readonly TranslationRequest[]): TranslationResult[] {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { translations?: unknown }).translations)) {
    throw new Error("Translation backend returned an invalid response");
  }
  const translations = (value as { translations: unknown[] }).translations;
  if (translations.length !== requested.length) throw new Error("Translation backend returned an incomplete response");
  const ids = new Set(requested.map((request) => request.anchorId));
  const returned = new Set<string>();
  return translations.map((item, index) => {
    if (typeof item !== "object" || item === null) throw new Error(`Translation backend result ${index} is invalid`);
    const result = item as Record<string, unknown>;
    if (typeof result.anchorId !== "string" || !ids.has(result.anchorId) || returned.has(result.anchorId)) {
      throw new Error(`Translation backend result ${index} has an invalid anchorId`);
    }
    if (
      typeof result.full !== "string" || result.full.length === 0 || result.full.length > MAX_TRANSLATION_LENGTH
      || typeof result.compact !== "string" || result.compact.length === 0 || result.compact.length > MAX_TRANSLATION_LENGTH
    ) {
      throw new Error(`Translation backend result ${index} has invalid text`);
    }
    returned.add(result.anchorId);
    return { anchorId: result.anchorId, full: result.full, compact: result.compact };
  });
}

function appendRequestId(error: unknown, requestId: string | null): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (!requestId || message.includes("[request_id:")) return error instanceof Error ? error : new Error(message);
  const next = new Error(`${message} [request_id:${requestId}]`);
  if (error instanceof Error) next.name = error.name;
  return next;
}

export async function translateViaBackend(
  config: BackendConfig,
  pageOrigin: string,
  requests: readonly TranslationRequest[],
  targetLanguage: TargetLanguage,
  fetchImpl: typeof fetch = fetch,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
): Promise<TranslationResult[]> {
  const endpoint = assertValidConfig(config);
  const configuredTimeout = typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
    ? config.timeoutMs
    : requestTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), configuredTimeout);
  let requestId: string | null = null;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        pageOrigin,
        targetLanguage,
        items: requests.map(({ anchorId, source, component }) => ({ anchorId, source, component, dataClass: "normal" })),
      }),
      signal: controller.signal,
    });
    requestId = response.headers.get("x-request-id")?.trim() || null;
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string"
        ? (body as { code: string }).code
        : "backend_request_failed";
      throw appendRequestId(new Error(`Translation backend rejected request: ${code}`), requestId);
    }
    try {
      return parseResults(body, requests);
    } catch (error) {
      throw appendRequestId(error, requestId);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Translation backend request timed out");
    throw appendRequestId(error, requestId);
  } finally {
    clearTimeout(timeout);
  }
}
