import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mockTranslateBatch } from "../../src/shared/mock-translation";
import {
  assertBearerToken,
  ContractError,
  createRateLimiter,
  MAX_REQUEST_BYTES,
  parseAllowedOrigins,
  parseTranslationRequest,
  validateTranslationResults,
} from "./contract";

const port = Number(process.env.LAYOUT_TRANSLATE_MOCK_PORT ?? 8787);
const authToken = process.env.LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN;
const allowedPageOrigins = parseAllowedOrigins(process.env.LAYOUT_TRANSLATE_ALLOWED_ORIGINS);
const allowedClientOrigins = parseAllowedOrigins(process.env.LAYOUT_TRANSLATE_ALLOWED_CLIENT_ORIGINS);
const rateLimit = Number(process.env.LAYOUT_TRANSLATE_RATE_LIMIT ?? 60);
const limiter = createRateLimiter(Number.isFinite(rateLimit) && rateLimit > 0 ? rateLimit : 60);

function corsHeaders(request: IncomingMessage): Record<string, string> {
  const origin = request.headers.origin;
  if (!origin || !allowedClientOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "Origin",
  };
}

function writeJson(request: IncomingMessage, response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(request),
  });
  response.end(JSON.stringify(body));
}

function sendError(request: IncomingMessage, response: ServerResponse, error: unknown): void {
  if (error instanceof ContractError) {
    writeJson(request, response, error.status, { code: error.code, error: error.message });
    return;
  }
  writeJson(request, response, 500, { code: "internal_error", error: "Translation request failed" });
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
  const requestOrigin = request.headers.origin;
  if (requestOrigin && !allowedClientOrigins.includes(requestOrigin)) {
    writeJson(request, response, 403, { code: "origin_not_allowed", error: "Client origin is not allowed" });
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/translate") {
    writeJson(request, response, 404, { code: "not_found", error: "Not found" });
    return;
  }

  try {
    assertBearerToken(request.headers.authorization, authToken);
    const clientKey = request.socket.remoteAddress ?? "unknown";
    if (!limiter.allow(clientKey)) {
      throw new ContractError("rate_limited", 429, "Translation rate limit exceeded");
    }
    const body = await readBody(request);
    const parsed = parseTranslationRequest(body, allowedPageOrigins);
    // Keep the provider payload limited to the contract fields; no source-page
    // metadata or extension-owned fields are forwarded implicitly.
    const providerResults = await mockTranslateBatch(
      parsed.items.map(({ anchorId, source, component }) => ({ anchorId, source, component })),
      parsed.targetLanguage,
    );
    const translations = validateTranslationResults(parsed.items, providerResults);
    writeJson(request, response, 200, { translations });
  } catch (error) {
    sendError(request, response, error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Layout Translate mock backend listening on http://127.0.0.1:${port}`);
});
