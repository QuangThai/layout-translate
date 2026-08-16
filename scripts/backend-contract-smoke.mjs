import { createServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { taskkillCommand } from "./process-tree.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const runnerPath = join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs");
const authToken = "backend-smoke-token";
const allowedOrigin = "http://127.0.0.1:4173";

function assert(condition, message) {
  if (!condition) throw new Error(`Backend smoke assertion failed: ${message}`);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  assert(port, "could not allocate a backend smoke port");
  return port;
}

async function request(baseUrl, body, authorization = authToken) {
  const response = await fetch(`${baseUrl}/v1/translate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
    requestId: response.headers.get("x-request-id"),
  };
}

async function waitForServer(baseUrl, body) {
  const deadline = Date.now() + 15_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await request(baseUrl, body);
      if (result.status === 200) return result;
      lastError = new Error(`HTTP ${result.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for backend server${lastError ? `: ${lastError.message}` : ""}`);
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync(taskkillCommand(), ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // The process may have exited between the status check and taskkill.
    }
  } else {
    child.kill("SIGTERM");
  }
}

async function main() {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const validBody = {
    pageOrigin: allowedOrigin,
    targetLanguage: "en",
    items: [{ anchorId: "anchor-1", source: "Company", component: "navigation", dataClass: "normal" }],
  };
  const server = spawn(process.execPath, [runnerPath, join(repositoryRoot, "backend", "src", "mock-server.ts")], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      LAYOUT_TRANSLATE_MOCK_PORT: String(port),
      LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN: authToken,
      LAYOUT_TRANSLATE_ALLOWED_ORIGINS: allowedOrigin,
      LAYOUT_TRANSLATE_ALLOWED_CLIENT_ORIGINS: "",
      LAYOUT_TRANSLATE_RATE_LIMIT: "3",
    },
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    const valid = await waitForServer(baseUrl, validBody);
    assert(valid.body.translations?.[0]?.anchorId === "anchor-1", "authorized request returned correlated translation");

    const unauthorized = await request(baseUrl, validBody, null);
    assert(unauthorized.status === 401, "missing authorization is rejected");

    const disallowedOrigin = await request(baseUrl, { ...validBody, pageOrigin: "https://outside.example.test" });
    assert(disallowedOrigin.status === 403, "non-allowlisted page origin is rejected");

    const sensitive = await request(baseUrl, {
      ...validBody,
      items: [{ anchorId: "anchor-2", source: "password", component: "paragraph", dataClass: "normal" }],
    });
    assert(sensitive.status === 422, "protected content is rejected");

    const rateLimited = await request(baseUrl, validBody);
    assert(rateLimited.status === 429, "requests over the configured rate limit are rejected");
    const requestIds = [valid, unauthorized, disallowedOrigin, sensitive, rateLimited].map((result) => result.requestId);
    assert(requestIds.every((requestId) => requestId), "every response exposes a non-content request correlation ID");
    assert(new Set(requestIds).size === requestIds.length, "each response receives a unique request correlation ID");

    console.log(JSON.stringify({
      result: "passed",
      valid: valid.status,
      unauthorized: unauthorized.status,
      disallowedOrigin: disallowedOrigin.status,
      sensitive: sensitive.status,
      rateLimited: rateLimited.status,
      correlatedResponses: requestIds.length,
      uniqueRequestIds: new Set(requestIds).size,
    }, null, 2));
  } finally {
    stopProcess(server);
    await sleep(250);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
