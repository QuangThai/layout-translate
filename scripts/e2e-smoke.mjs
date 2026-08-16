import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { taskkillCommand } from "./process-tree.mjs";
import { findChrome } from "./chrome.mjs";
import {
  classifyFailure,
  extractRequestId,
  readTraceMetadata,
  removeOwnedArtifacts,
} from "./trace-metadata.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const extensionRoot = join(repositoryRoot, ".output", "chrome-mv3");
const frameworkArtifactRoot = join(repositoryRoot, ".output", "framework-fixture");
const fixturePath = "/fixtures/representative.html";
const POC_HARD_SHIFT_TOLERANCE_PX = 5;

const CLEANUP_TIMEOUT_MS = 5_000;

// The browser names the reason it refused an extension, and the failure that
// reports it lives in another function, so the buffer is shared.
const browserStderr = [];

function browserTraceName(chromePath) {
  return chromePath.split(/[\\\\/]/u).pop() ?? "chrome";
}

function assert(condition, message) {
  if (!condition) throw new Error(`E2E assertion failed: ${message}`);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForProcessExit(child) {
  if (!child || child.exitCode !== null) return true;
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    sleep(CLEANUP_TIMEOUT_MS),
  ]);
  return child.exitCode !== null;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return true;
  if (process.platform === "win32") {
    try {
      execFileSync(taskkillCommand(), ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // The process may have exited between the status check and taskkill.
    }
  } else {
    child.kill("SIGTERM");
  }
  return waitForProcessExit(child);
}

async function closeServer(server) {
  if (!server.listening) return true;
  return Promise.race([
    new Promise((resolvePromise) => server.close((error) => resolvePromise(!error))),
    sleep(CLEANUP_TIMEOUT_MS).then(() => false),
  ]);
}

function attachBackendTrace(child, backendTrace) {
  const consumeStdout = (chunk) => {
    const lines = String(chunk).split(/\r?\n/u).filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event?.event !== "translation_response" || typeof event.requestId !== "string") continue;
        backendTrace.responseCount += 1;
        if (!backendTrace.requestIds.includes(event.requestId)) backendTrace.requestIds.push(event.requestId);
      } catch {
        // The listening line is intentionally ignored; only structured, non-content events are retained.
      }
    }
  };
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", consumeStdout);
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    backendTrace.stderrLineCount += String(chunk).split(/\r?\n/u).filter(Boolean).length;
  });
}

async function removeWithRetry(target, attempts = 20) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true });
      return { removed: true };
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  return { removed: false, error: lastError };
}

async function findFreePort() {
  const server = createTcpServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  assert(port, "could not allocate a local CDP port");
  return port;
}

async function waitFor(predicate, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
}


function startFixtureServer() {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
    if (relativePath === "favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const frameworkPrefix = "framework-fixture/";
    const isFrameworkArtifact = relativePath.startsWith(frameworkPrefix);
    const fileRoot = isFrameworkArtifact ? frameworkArtifactRoot : repositoryRoot;
    const filePath = resolve(fileRoot, isFrameworkArtifact ? relativePath.slice(frameworkPrefix.length) : relativePath);
    if (!(filePath === fileRoot || filePath.startsWith(`${fileRoot}${sep}`)) || !existsSync(filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const body = readFileSync(filePath);
    const contentType = filePath.endsWith(".html")
      ? "text/html; charset=utf-8"
      : filePath.endsWith(".css")
        ? "text/css; charset=utf-8"
        : filePath.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  });
  return server;
}

class CdpClient {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    webSocket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  call(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.webSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  async close() {
    this.webSocket.close();
  }
}

async function getJson(url) {
  const response = await fetch(url);
  assert(response.ok, `HTTP ${response.status} from ${url}`);
  return response.json();
}

async function connectCdp(port) {
  assert(
    typeof WebSocket === "function",
    "Node 22+ with a built-in WebSocket implementation is required for the smoke runner",
  );
  const version = await waitFor(() => getJson(`http://127.0.0.1:${port}/json/version`), "Chrome CDP");
  const webSocket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    webSocket.addEventListener("open", resolvePromise, { once: true });
    webSocket.addEventListener("error", reject, { once: true });
  });
  return new CdpClient(webSocket);
}

async function evaluate(cdp, target, expression) {
  const result = await cdp.call(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    target.sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
  }
  return result.result?.value;
}

async function captureScreenshot(cdp, target, path) {
  const result = await cdp.call(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true },
    target.sessionId,
  );
  assert(result?.data, `Chrome did not return screenshot data for ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(result.data, "base64"));
  return path;
}

async function attachTarget(cdp, targetId) {
  const attached = await cdp.call("Target.attachToTarget", { targetId, flatten: true });
  return { targetId, sessionId: attached.sessionId };
}

async function findExtensionPopup(cdp) {
  // The service worker registers a moment after the browser starts, and how long
  // that takes depends on the machine. Asking once worked on a developer's
  // laptop and failed on a CI runner, which is the same bug either way.
  let extensionIds;
  try {
    extensionIds = await waitFor(async () => {
      const targets = await cdp.call("Target.getTargets");
      const found = targets.targetInfos
        .filter((target) => target.type === "service_worker" && target.url.endsWith("/background.js"))
        .map((target) => target.url.slice("chrome-extension://".length).split("/")[0]);
      return found.length > 0 ? found : false;
    }, "the extension service worker to register", 30_000);
  } catch (error) {
    // Say what the browser does have. "No service worker" is the same message
    // whether the extension failed to load, loaded under another id, or the
    // browser never started a worker at all.
    const targets = await cdp.call("Target.getTargets").catch(() => ({ targetInfos: [] }));
    const seen = targets.targetInfos.map((target) => target.type + ":" + target.url.slice(0, 60));
    throw new Error(error.message + "; targets seen: " + JSON.stringify(seen) + "; browser said: " + JSON.stringify(browserStderr.slice(-6)));
  }

  for (const extensionId of extensionIds) {
    const target = await cdp.call("Target.createTarget", {
      url: `chrome-extension://${extensionId}/popup.html`,
    });
    const popup = await attachTarget(cdp, target.targetId);
    try {
      await waitFor(
        () => evaluate(cdp, popup, "Boolean(document.querySelector('main.popup-shell'))"),
        `extension popup for ${extensionId}`,
      );
      return popup;
    } catch {
      await cdp.call("Target.closeTarget", { targetId: popup.targetId });
    }
  }
  throw new Error("Could not identify the built extension popup target");
}

async function main() {
  assert(existsSync(extensionRoot), "built extension is missing; run `npm run build` first");
  const chromePath = findChrome();
  const cdpPort = await findFreePort();
  const profilePath = mkdtempSync(join(tmpdir(), "layout-translate-e2e-"));
  const startedAt = new Date().toISOString();
  const reportPath = process.env.LAYOUT_TRANSLATE_E2E_REPORT
    ?? join(repositoryRoot, ".output", "e2e-smoke-report.json");
  const artifactDir = process.env.LAYOUT_TRANSLATE_E2E_ARTIFACT_DIR
    ?? join(repositoryRoot, ".output");
  const screenshotPaths = {
    english: join(artifactDir, "e2e-english.png"),
    vietnamese: join(artifactDir, "e2e-vietnamese.png"),
  };
  const screenshotFiles = {
    english: "e2e-english.png",
    vietnamese: "e2e-vietnamese.png",
  };
  const artifactReset = removeOwnedArtifacts([reportPath, ...Object.values(screenshotPaths)]);
  const screenshotCaptured = { english: false, vietnamese: false };
  const traceMetadata = readTraceMetadata({
    repositoryRoot,
    artifactPaths: {
      extension: extensionRoot,
      frameworkFixture: frameworkArtifactRoot,
    },
  });
  const server = startFixtureServer();
  let browser;
  let backendProcess;
  let backendPort;
  let backendToken;
  let cdp;
  let fixture;
  let popup;
  let fixturePort;
  let failureCode;
  const pageErrors = [];
  const consoleErrors = [];
  const logErrors = [];
  const backendFailureRequestIds = new Set();
  const backendTrace = { responseCount: 0, requestIds: [], stderrLineCount: 0 };
  let report = {
    schema: "layout-translate/e2e-report/v1",
    result: "failed",
    startedAt,
    node: process.version,
    trace: {
      ...traceMetadata,
      browser: { executable: browserTraceName(chromePath), product: null, revision: null },
      backend: backendTrace,
    },
  };
  report.commit = traceMetadata.repository.revision ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? null;

  try {
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const serverAddress = server.address();
    fixturePort = typeof serverAddress === "object" && serverAddress ? serverAddress.port : undefined;
    assert(fixturePort, "fixture server did not expose a port");

    browser = spawn(
      chromePath,
      [
        `--remote-debugging-port=${cdpPort}`,
        "--remote-allow-origins=*",
        `--user-data-dir=${profilePath}`,
        `--disable-extensions-except=${extensionRoot}`,
        `--load-extension=${extensionRoot}`,
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        ...(process.env.LAYOUT_TRANSLATE_HEADFUL === "1" ? [] : ["--headless=new"]),
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,900",
        ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
      ],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    browser.stderr?.setEncoding("utf8");
    browser.stderr?.on("data", (chunk) => {
      browserStderr.push(...String(chunk).split(/\r?\n/u).filter(Boolean));
      if (browserStderr.length > 40) browserStderr.splice(0, browserStderr.length - 40);
    });
    cdp = await connectCdp(cdpPort);
    const browserVersion = await cdp.call("Browser.getVersion");
    report.trace.browser = {
      executable: browserTraceName(chromePath),
      product: browserVersion.product ?? null,
      revision: browserVersion.revision ?? null,
    };

    backendPort = await findFreePort();
    backendToken = "dev-only-token";
    backendProcess = spawn(
      process.execPath,
      [join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"), join(repositoryRoot, "backend", "src", "mock-server.ts")],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          LAYOUT_TRANSLATE_MOCK_PORT: String(backendPort),
          LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN: backendToken,
          LAYOUT_TRANSLATE_ALLOWED_ORIGINS: `http://127.0.0.1:${fixturePort}`,
          LAYOUT_TRANSLATE_ALLOWED_CLIENT_ORIGINS: "",
          LAYOUT_TRANSLATE_ALLOW_EXTENSION_CLIENTS: "true",
          LAYOUT_TRANSLATE_MOCK_FAILURE_MODE: "none",
          LAYOUT_TRANSLATE_ALLOW_TEST_FAILURE_MODE: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    attachBackendTrace(backendProcess, backendTrace);
    await waitFor(
      () => fetch(`http://127.0.0.1:${backendPort}/v1/translate`, { method: "OPTIONS" }).then(() => true).catch(() => false),
      "mock backend",
    );
    const fixtureTarget = await cdp.call("Target.createTarget", {
      url: `http://127.0.0.1:${fixturePort}${fixturePath}`,
    });
    fixture = await attachTarget(cdp, fixtureTarget.targetId);
    cdp.on("Runtime.exceptionThrown", (event) => {
      if (event.sessionId === fixture.sessionId) pageErrors.push("runtime_exception");
    });
    cdp.on("Runtime.consoleAPICalled", (event) => {
      if (event.sessionId === fixture.sessionId && ["error", "assert"].includes(event.params?.type)) {
        consoleErrors.push(event.params.type === "assert" ? "console_assert" : "console_error");
      }
    });
    cdp.on("Log.entryAdded", (event) => {
      if (event.sessionId === fixture.sessionId && event.params?.entry?.level === "error") {
        logErrors.push("browser_log_error");
      }
    });
    await cdp.call("Runtime.enable", {}, fixture.sessionId);
    await cdp.call("Log.enable", {}, fixture.sessionId);
    await waitFor(
      () => evaluate(cdp, fixture, "Boolean(document.querySelector('nav a'))"),
      "fixture content",
    );
    popup = await findExtensionPopup(cdp);
    await evaluate(cdp, popup, `chrome.storage.local.set({"layout-translate:backend": { url: "http://127.0.0.1:${backendPort}", token: "${backendToken}" }})`);

    await cdp.call("Target.activateTarget", { targetId: fixture.targetId });
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === 'Company'"),
      "English translation",
    );
    // The same Japanese string is translated in the navigation and left alone in
    // the tagline, so this proves the opt-out and not merely a missed node.
    const optOutPreserved = await evaluate(
      cdp,
      fixture,
      "document.querySelector('.brand-tagline')?.textContent?.trim() === '会社情報'",
    );
    assert(optOutPreserved, 'content marked translate="no" must remain untranslated');
    await waitFor(
      () => evaluate(
        cdp,
        fixture,
        `(() => document.documentElement.dataset.reactReady === "true"
          && document.documentElement.dataset.vueReady === "true")()`,
      ),
      "React and Vue fixtures mounted",
    );
    await waitFor(
      () => evaluate(
        cdp,
        fixture,
        `(() => document.querySelector('#react-copy')?.textContent === "Terms"
          && document.querySelector('#vue-copy')?.textContent === "Company")()`,
      ),
      "React and Vue initial translations",
    );
    await evaluate(cdp, fixture, "document.querySelector('#react-rerender')?.click()");
    await evaluate(cdp, fixture, "document.querySelector('#vue-rerender')?.click()");
    await waitFor(
      () => evaluate(
        cdp,
        fixture,
        `(() => document.querySelector('#react-copy')?.textContent === "New notification"
          && document.querySelector('#vue-copy')?.textContent === "New notification")()`,
      ),
      "React and Vue rerender translations",
    );
    const english = await evaluate(
      cdp,
      fixture,
      `(() => ({
        navWidth: document.querySelector('nav')?.getBoundingClientRect().width,
        firstAnchor: document.querySelector('nav a')?.getBoundingClientRect().x,
        nav: [...document.querySelectorAll('nav a')].map((element) => element.textContent),
        critical: {
          text: document.querySelector('#route-button')?.textContent,
          title: document.querySelector('#route-button')?.title,
          ariaLabel: document.querySelector('#route-button')?.getAttribute('aria-label'),
          clientWidth: document.querySelector('#route-button')?.clientWidth,
          scrollWidth: document.querySelector('#route-button')?.scrollWidth,
        },
        tooltips: [...document.querySelectorAll('[title]')].map((element) => element.title),
        react: {
          text: document.querySelector('#react-copy')?.textContent,
          button: document.querySelector('#react-rerender')?.textContent,
        },
        vue: {
          text: document.querySelector('#vue-copy')?.textContent,
          button: document.querySelector('#vue-rerender')?.textContent,
        },
      }))()`,
    );
    assert(english.nav.join("|") === "Company|Contact us|Terms", "English navigation rendered");
    assert(english.navWidth > 0, "English navigation geometry was measured");
    assert(english.critical.text === "Review and send", "semantic-critical action keeps its full English translation");
    assert(english.critical.title === "Review and send", "semantic-critical overflow exposes the full English translation");
    assert(english.critical.ariaLabel === "Review and send", "semantic-critical overflow exposes an accessible full translation");
    assert(english.critical.scrollWidth > english.critical.clientWidth, "semantic-critical action is actually constrained");
    assert(english.tooltips.length > 0, "constrained content exposes full-text tooltips");
    assert(english.react.text === "New notification", "React rerender is translated in English");
    assert(english.vue.text === "New notification", "Vue rerender is translated in English");

    const getExtensionState = () => evaluate(
      cdp,
      popup,
      "chrome.storage.local.get('layout-translate:state').then((value) => value['layout-translate:state'])",
    );
    await evaluate(cdp, popup, `chrome.storage.local.set({"layout-translate:backend": { url: "http://127.0.0.1:${backendPort}", token: "invalid-token" }})`);
    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === '会社情報'"),
      "original source after backend failure setup",
    );
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    const failedTranslationState = await waitFor(
      async () => {
        const state = await getExtensionState();
        return state?.status === "error" && typeof state.lastError === "string" ? state : false;
      },
      "backend authorization failure status",
    );
    const authorizationRequestId = extractRequestId(failedTranslationState.lastError);
    if (authorizationRequestId) backendFailureRequestIds.add(authorizationRequestId);
    const sourceAfterBackendFailure = await evaluate(
      cdp,
      fixture,
      "({ nav: [...document.querySelectorAll('nav a')].map((element) => element.textContent), titleCount: document.querySelectorAll('[title]').length })",
    );
    assert(failedTranslationState.lastError.includes("unauthorized"), "backend authorization failure is surfaced without page content");
    assert(sourceAfterBackendFailure.nav.join("|") === "会社情報|お問い合わせはこちら|利用規約", "backend failure preserves the Japanese source");
    assert(sourceAfterBackendFailure.titleCount === 0, "backend failure does not apply presentation fallback");

    await evaluate(cdp, popup, `chrome.storage.local.set({"layout-translate:backend": { url: "http://127.0.0.1:${backendPort}", token: "${backendToken}" }})`);
    const failureModes = ["reject-422", "malformed-502", "timeout"];
    for (const mode of failureModes) {
      await fetch(`http://127.0.0.1:${backendPort}/__test/failure-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) });
      await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
      await waitFor(
        () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === '会社情報'"),
        `${mode} source reset`,
      );
      await waitFor(
        () => evaluate(cdp, popup, "document.querySelector('button.toggle')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('button.toggle')?.disabled"),
        `${mode} restore state`,
      );
      await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
      const modeState = await waitFor(
        async () => {
          const state = await getExtensionState();
          return state?.status === "error" && typeof state.lastError === "string" ? state : false;
        },
        `${mode} failure status`,
        // A timeout is now retried once before the reader is told, so the error
        // takes two request timeouts plus the backoff to surface.
        mode === "timeout" ? 40_000 : 20_000,
      );
      const modeRequestId = extractRequestId(modeState.lastError);
      if (modeRequestId) backendFailureRequestIds.add(modeRequestId);
      const modeSource = await evaluate(cdp, fixture, "({ nav: [...document.querySelectorAll('nav a')].map((element) => element.textContent), titleCount: document.querySelectorAll('[title]').length })");
      assert(modeSource.nav.join("|") === "会社情報|お問い合わせはこちら|利用規約", `${mode} preserves Japanese source`);
      assert(modeSource.titleCount === 0, `${mode} does not apply presentation fallback`);
      assert(modeState.lastError.includes(mode === "reject-422" ? "sensitive_content_blocked" : mode === "malformed-502" ? "provider_invalid_response" : "timed out"), `${mode} exposes a diagnostic code`);
    }
    await fetch(`http://127.0.0.1:${backendPort}/__test/failure-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "none" }) });
    await evaluate(cdp, popup, `chrome.storage.local.set({"layout-translate:backend": { url: "http://127.0.0.1:${backendPort}", token: "${backendToken}" }})`);
    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    await waitFor(
      () => evaluate(cdp, popup, "document.querySelector('button.toggle')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('button.toggle')?.disabled"),
      "backend failure restore state",
    );
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === 'Company'"),
      "translation recovery after backend authorization is restored",
    );

    await fetch(`http://127.0.0.1:${backendPort}/__test/failure-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "delay-success" }) });
    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === '会社情報'"),
      "delayed translation source reset",
    );
    await waitFor(
      () => evaluate(cdp, popup, "document.querySelector('button.toggle')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('button.toggle')?.disabled"),
      "delayed translation restore state",
    );
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      async () => (await getExtensionState())?.status === "translating",
      "delayed translation request started",
    );
    await sleep(100);
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      async () => {
        const state = await getExtensionState();
        return state?.enabled === false && state.status === "restored" ? state : false;
      },
      "restore while translation request is pending",
    );
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === '会社情報'"),
      "restore wins over delayed translation response",
    );
    await sleep(500);
    const disabledDuringRequest = await evaluate(
      cdp,
      fixture,
      "[...document.querySelectorAll('nav a')].map((element) => element.textContent).join('|')",
    );
    const disabledDuringRequestState = await getExtensionState();
    assert(disabledDuringRequest === "会社情報|お問い合わせはこちら|利用規約", "stale delayed response cannot re-render after restore");
    assert(disabledDuringRequestState?.enabled === false && disabledDuringRequestState.status === "restored", "stale delayed response cannot overwrite restored state");

    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      async () => (await getExtensionState())?.status === "translating",
      "delayed language-race request started",
    );
    await sleep(100);
    await evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(2)').click()");
    await waitFor(
      () => evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(2)')?.getAttribute('aria-pressed') === 'true'"),
      "Vietnamese selected during delayed request",
    );
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === 'Thông tin công ty'"),
      "new language wins over delayed English response",
    );

    await fetch(`http://127.0.0.1:${backendPort}/__test/failure-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "none" }) });
    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    await waitFor(
      () => evaluate(cdp, popup, "document.querySelector('button.toggle')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('button.toggle')?.disabled"),
      "concurrency proof cleanup restore state",
    );
    await evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(1)').click()");
    await waitFor(
      () => evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(1)')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('.language-switch button:nth-child(1)')?.disabled"),
      "concurrency proof cleanup language state",
    );
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === 'Company'"),
      "normal translation after concurrency proof",
    );

    // A transient provider failure used to discard the whole pass. The mock
    // refuses the first request of each batch and answers the retry, so this
    // proves the page recovers on its own rather than needing the reader to
    // try again.
    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === '会社情報'"),
      "restore before the transient failure proof",
    );
    await fetch(`http://127.0.0.1:${backendPort}/__test/failure-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "flaky-503" }) });
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === 'Company'"),
      "translation recovers from a transient provider failure",
    );
    const transientState = await getExtensionState();
    assert(transientState?.status !== "error", "a retried batch must not leave the page in an error state");
    const retriedAudit = await evaluate(
      cdp,
      popup,
      "(async () => { const response = await chrome.runtime.sendMessage({ type: 'GET_AUDIT' }); return response?.audit?.retries ?? 0; })()",
    );
    assert(retriedAudit > 0, "the retry must be reported, not silently absorbed");
    await fetch(`http://127.0.0.1:${backendPort}/__test/failure-mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "none" }) });

    const englishFocus = await evaluate(
      cdp,
      fixture,
      `(() => {
        const target = document.querySelector('#route-button');
        target?.focus();
        return {
          activeId: document.activeElement?.id,
          title: target?.title,
          tabIndex: target?.tabIndex,
        };
      })()`,
    );
    assert(englishFocus.activeId === "route-button", "critical action is keyboard focusable");
    assert(englishFocus.tabIndex === 0, "critical action keeps the native tab order");
    assert(englishFocus.title === "Review and send", "critical action exposes its tooltip on focus");

    const clickPoint = await evaluate(
      cdp,
      fixture,
      `(() => {
        const target = document.querySelector('#route-button');
        if (!target) return null;
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
    );
    assert(clickPoint, "mouse target is present");
    await cdp.call("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: clickPoint.x,
      y: clickPoint.y,
      button: "left",
      clickCount: 1,
    }, fixture.sessionId);
    await cdp.call("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: clickPoint.x,
      y: clickPoint.y,
      button: "left",
      clickCount: 1,
    }, fixture.sessionId);
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('#dynamic-copy')?.textContent === 'New notification'"),
      "mouse click activation of the constrained action",
    );
    const escapeFallback = await evaluate(
      cdp,
      fixture,
      `(() => {
        const target = document.querySelector('#route-button');
        target?.focus();
        target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return {
          activeId: document.activeElement?.id,
          title: target?.title,
          ariaLabel: target?.getAttribute('aria-label'),
          hostOverlays: document.querySelectorAll('[data-layout-translate-tooltip]').length,
        };
      })()`,
    );
    await cdp.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, fixture.sessionId);
    await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, fixture.sessionId);
    assert(escapeFallback.activeId === "route-button", "Escape leaves the constrained action keyboard reachable");
    assert(escapeFallback.title === "Review and send", "Escape preserves the native full-text title");
    assert(escapeFallback.ariaLabel === "Review and send", "Escape preserves the accessible full translation");
    assert(escapeFallback.hostOverlays === 0, "Escape does not require a reflowing host-page tooltip layer");

    await cdp.call("Emulation.setTouchEmulationEnabled", { enabled: true }, fixture.sessionId);
    try {
      const touchPoint = await evaluate(
        cdp,
        fixture,
        `(() => {
          const target = document.querySelector('#framework-rerender');
          if (!target) return null;
          const rect = target.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`,
      );
      assert(touchPoint, "touch target is present");
      await cdp.call("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: touchPoint.x, y: touchPoint.y, id: 1 }],
      }, fixture.sessionId);
      await cdp.call("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      }, fixture.sessionId);
      await waitFor(
        () => evaluate(cdp, fixture, "document.querySelector('#framework-copy')?.textContent === 'New notification'"),
        "touch activation of a native control",
      );
    } finally {
      await cdp.call("Emulation.setTouchEmulationEnabled", { enabled: false }, fixture.sessionId);
    }
    const interactionEvidence = {
      clickActivationVerified: true,
      escapePreservedFallback: true,
      touchActivationVerified: true,
    };

    const fontState = await waitFor(
      () => evaluate(
        cdp,
        fixture,
        `(() => {
          if (document.documentElement.dataset.fontReady !== "true") return false;
          const text = document.querySelector('#font-sensitive')?.textContent;
          return text === "Company"
            ? { status: document.fonts?.status ?? "unsupported", text }
            : false;
        })()`,
      ),
      "delayed fixture font readiness and translated metrics",
    );
    assert(fontState.text === "Company", "font-sensitive content stayed translated after font readiness");

    const englishGeometry = await evaluate(
      cdp,
      fixture,
      `(() => {
        const table = document.querySelector('table');
        const grid = document.querySelector('.content-grid');
        return {
          tableWidth: table?.getBoundingClientRect().width ?? 0,
          tableScrollWidth: table?.scrollWidth ?? 0,
          gridWidth: grid?.getBoundingClientRect().width ?? 0,
          cardCount: document.querySelectorAll('[data-card]').length,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      })()`,
    );
    assert(englishGeometry.tableWidth > 0, "table geometry was measured");
    assert(englishGeometry.tableScrollWidth <= englishGeometry.tableWidth + 1, "table has no horizontal overflow");
    assert(englishGeometry.gridWidth > 0, "card grid geometry was measured");
    assert(englishGeometry.cardCount === 2, "representative card grid stayed intact");
    assert(!englishGeometry.pageOverflow, "English page has no horizontal overflow");
    await captureScreenshot(cdp, fixture, screenshotPaths.english);
    screenshotCaptured.english = true;

    await evaluate(cdp, fixture, "document.querySelector('#framework-rerender')?.click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('#framework-copy')?.textContent === 'New notification'"),
      "framework-style DOM rerender",
    );

    await evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(2)').click()");
    await waitFor(
      () => evaluate(
        cdp,
        fixture,
        `(() => document.querySelector('nav a')?.textContent === 'Thông tin công ty'
          && document.querySelector('#react-copy')?.textContent === 'Thông báo mới'
          && document.querySelector('#vue-copy')?.textContent === 'Thông báo mới')()`,
      ),
      "Vietnamese translation",
    );
    const vietnamese = await evaluate(
      cdp,
      fixture,
      `(() => {
        const table = document.querySelector('table');
        return {
          navWidth: document.querySelector('nav')?.getBoundingClientRect().width,
          firstAnchor: document.querySelector('nav a')?.getBoundingClientRect().x,
          nav: [...document.querySelectorAll('nav a')].map((element) => element.textContent),
          framework: document.querySelector('#framework-copy')?.textContent,
          react: document.querySelector('#react-copy')?.textContent,
          vue: document.querySelector('#vue-copy')?.textContent,
          tableWidth: table?.getBoundingClientRect().width ?? 0,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          critical: {
            text: document.querySelector('#route-button')?.textContent,
            title: document.querySelector('#route-button')?.title,
            ariaLabel: document.querySelector('#route-button')?.getAttribute('aria-label'),
          },
        };
      })()`,
    );
    assert(vietnamese.nav.join("|") === "Thông tin công ty|Liên hệ với chúng tôi|Điều khoản", "Vietnamese navigation rendered");
    assert(vietnamese.navWidth === english.navWidth, "hard-preserve navigation width stayed stable");
    const navigationAnchorShift = Math.abs(vietnamese.firstAnchor - english.firstAnchor);
    assert(
      navigationAnchorShift <= POC_HARD_SHIFT_TOLERANCE_PX,
      `hard-preserve navigation anchor shift stayed within the provisional ${POC_HARD_SHIFT_TOLERANCE_PX}px spike target`,
    );
    assert(vietnamese.framework === "Thông báo mới", "framework-style rerender translated in Vietnamese");
    assert(vietnamese.react === "Thông báo mới", "React rerender is translated in Vietnamese");
    assert(vietnamese.vue === "Thông báo mới", "Vue rerender is translated in Vietnamese");
    assert(vietnamese.tableWidth === englishGeometry.tableWidth, "hard-preserve table width stayed stable");
    assert(!vietnamese.pageOverflow, "Vietnamese page has no horizontal overflow");
    assert(vietnamese.critical.text === "Xem lại và gửi", "semantic-critical action keeps its full Vietnamese translation");
    assert(vietnamese.critical.title === "Xem lại và gửi", "semantic-critical overflow exposes the full Vietnamese translation");
    assert(vietnamese.critical.ariaLabel === "Xem lại và gửi", "semantic-critical overflow exposes an accessible Vietnamese translation");
    await captureScreenshot(cdp, fixture, screenshotPaths.vietnamese);
    screenshotCaptured.vietnamese = true;

    await evaluate(
      cdp,
      fixture,
      `(() => {
        const target = document.querySelector('#route-button');
        if (!target) return false;
        target.style.backgroundColor = 'rgb(12, 34, 56)';
        target.style.width = '120px';
        target.title = 'Page-owned tooltip';
        target.setAttribute('aria-label', 'Page-owned action');
        return true;
      })()`,
    );
    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    const ownershipRestored = await waitFor(
      () => evaluate(
        cdp,
        fixture,
        `(() => {
          const target = document.querySelector('#route-button');
          return target?.textContent === '確認して送信'
            && target?.title === 'Page-owned tooltip'
            && target?.getAttribute('aria-label') === 'Page-owned action'
            && target?.style.backgroundColor === 'rgb(12, 34, 56)'
            && target?.style.width === '120px';
        })()`,
      ),
      "page-owned presentation survives restore",
    );
    assert(ownershipRestored === true, "restore preserves page-owned style, title, and aria-label changes");
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === 'Thông tin công ty' && document.querySelector('#route-button')?.textContent === 'Xem lại và gửi'"),
      "translation resumes after ownership restore proof",
    );

    await evaluate(cdp, fixture, "document.querySelector('#route-button').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('#dynamic-copy')?.textContent === 'Thông báo mới'"),
      "translated SPA content",
    );
    const stateBeforeRemoval = await waitFor(
      async () => {
        const state = await getExtensionState();
        return state?.status === "rendered" && state.translatedAnchors > 0 ? state : false;
      },
      "rendered anchor state",
    );
    await evaluate(cdp, fixture, "document.querySelector('#route-button')?.remove()");
    const stateAfterRemoval = await waitFor(
      async () => {
        const state = await getExtensionState();
        return state?.translatedAnchors < stateBeforeRemoval.translatedAnchors ? state : false;
      },
      "disconnected source record cleanup",
    );

    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    const restored = await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('#dynamic-copy')?.textContent === '新しい通知'"),
      "restored SPA source",
    );
    const restoredState = await evaluate(
      cdp,
      fixture,
      `({
        nav: [...document.querySelectorAll('nav a')].map((element) => element.textContent),
        framework: document.querySelector('#framework-copy')?.textContent,
        react: document.querySelector('#react-copy')?.textContent,
        vue: document.querySelector('#vue-copy')?.textContent,
        fontSensitive: document.querySelector('#font-sensitive')?.textContent,
        titles: [...document.querySelectorAll('[title]')].length,
        ariaLabelsWithTitles: [...document.querySelectorAll('[title][aria-label]')].length,
      })`,
    );
    assert(restored === true, "restore completed");
    assert(restoredState.nav.join("|") === "会社情報|お問い合わせはこちら|利用規約", "original navigation restored");
    assert(restoredState.framework === "新しい通知", "framework rerender source restored");
    assert(restoredState.react === "新しい通知", "React rerender source restored");
    assert(restoredState.vue === "新しい通知", "Vue rerender source restored");
    assert(restoredState.fontSensitive === "会社情報", "font-sensitive source restored");
    assert(restoredState.titles === 0, "extension presentation styles and titles restored");
    assert(restoredState.ariaLabelsWithTitles === 0, "extension accessibility labels restored with presentation");

    const backendResponseCountBeforeLanguageGate = backendTrace.responseCount;
    await evaluate(
      cdp,
      fixture,
      `(() => {
        document.documentElement.lang = "en";
        document.body.replaceChildren(
          Object.assign(document.createElement("main"), {
            id: "english-only-page",
            textContent: "This page contains only English source text.",
          }),
        );
        return document.body.textContent;
      })()`,
    );
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    const unsupportedState = await waitFor(
      async () => {
        const state = await getExtensionState();
        return state?.status === "unsupported" ? state : false;
      },
      "non-Japanese source detection status",
    );
    const languageGate = await evaluate(
      cdp,
      fixture,
      "({ text: document.querySelector('#english-only-page')?.textContent, japaneseChars: (document.body.innerText.match(/[\\u3040-\\u30ff\\u3400-\\u9fff]/g) || []).length })",
    );
    assert(unsupportedState.translatedAnchors === 0, "non-Japanese page creates no translation anchors");
    assert(languageGate.text === "This page contains only English source text.", "non-Japanese page remains unchanged");
    assert(languageGate.japaneseChars === 0, "language gate fixture contains no Japanese characters");
    assert(backendTrace.responseCount === backendResponseCountBeforeLanguageGate, "non-Japanese page sends no translation request");
    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    await waitFor(
      () => evaluate(cdp, popup, "document.querySelector('button.toggle')?.getAttribute('aria-pressed') === 'false'"),
      "non-Japanese language gate cleanup",
    );
    assert(pageErrors.length === 0, `fixture page raised ${pageErrors.length} runtime exception(s)`);
    assert(consoleErrors.length === 0, `fixture page emitted ${consoleErrors.length} console error(s)`);

    report = {
      ...report,
      result: "passed",
      fixturePort,
      metrics: {
        english: {
          navWidth: english.navWidth,
          firstAnchor: english.firstAnchor,
          provisionalHardShiftTolerancePx: POC_HARD_SHIFT_TOLERANCE_PX,
          navItemCount: english.nav.length,
          criticalClientWidth: english.critical.clientWidth,
          criticalScrollWidth: english.critical.scrollWidth,
          tooltipCount: english.tooltips.length,
          accessibleFullText: Boolean(english.critical.ariaLabel),
          focusTarget: englishFocus.activeId,
          focusTabIndex: englishFocus.tabIndex,
          fontStatus: fontState.status,
          tableWidth: englishGeometry.tableWidth,
          tableScrollWidth: englishGeometry.tableScrollWidth,
          gridWidth: englishGeometry.gridWidth,
          cardCount: englishGeometry.cardCount,
          pageOverflow: englishGeometry.pageOverflow,
        },
        vietnamese: {
          navWidth: vietnamese.navWidth,
          firstAnchor: vietnamese.firstAnchor,
          navigationAnchorShift: navigationAnchorShift,
          navItemCount: vietnamese.nav.length,
          criticalHasTooltip: Boolean(vietnamese.critical.title),
          criticalHasAccessibleFullText: Boolean(vietnamese.critical.ariaLabel),
          frameworkRerenderVerified: vietnamese.framework === "Thông báo mới",
          reactRerenderVerified: vietnamese.react === "Thông báo mới",
          vueRerenderVerified: vietnamese.vue === "Thông báo mới",
          tableWidth: vietnamese.tableWidth,
          pageOverflow: vietnamese.pageOverflow,
        },
        frameworkRerenderTranslatedAndRestored: true,
        reactVueRerenderTranslatedAndRestored: true,
        fontReadinessVerified: true,
        keyboardFocusAndTooltipVerified: true,
        clickActivationVerified: interactionEvidence.clickActivationVerified,
        escapePreservedFallback: interactionEvidence.escapePreservedFallback,
        touchActivationVerified: interactionEvidence.touchActivationVerified,
        accessibilityFallbackVerified: true,
        presentationOwnershipVerified: ownershipRestored === true,
        screenshots: screenshotCaptured,
        screenshotFiles,
        dynamicSpaTranslatedAndRestored: true,
        originalRestored: true,
        sourceLanguageGateVerified: true,
        translationOptOutPreserved: optOutPreserved === true,
        backendFailureSourcePreserved: true,
        backendFailureStatus: failedTranslationState.status,
        backendFailureCodeObserved: failedTranslationState.lastError.includes("unauthorized"),
        backendFailureRequestIds: [...backendFailureRequestIds],
        backendFailureMatrixVerified: true,
        transientFailureRecovered: true,
        retriesObserved: retriedAudit,
        removedAnchors: stateBeforeRemoval.translatedAnchors - stateAfterRemoval.translatedAnchors,
        pageErrorCount: pageErrors.length,
        consoleErrorCount: consoleErrors.length,
        logErrorCount: logErrors.length,
      },
    };

      console.log(JSON.stringify({
        result: "passed",
        fixture: `http://127.0.0.1:${fixturePort}${fixturePath}`,
        dynamicSpa: "translated and restored",
        originalRestored: true,
        sourceLanguageGateVerified: true,
        removedAnchors: stateBeforeRemoval.translatedAnchors - stateAfterRemoval.translatedAnchors,
        navigationAnchorShift,
        pageErrorCount: pageErrors.length,
        consoleErrorCount: consoleErrors.length,
        logErrorCount: logErrors.length,
      }, null, 2));
    } catch (error) {
      failureCode = classifyFailure(error);
      throw error;
    } finally {
      if (popup) await cdp?.call("Target.closeTarget", { targetId: popup.targetId }).catch(() => undefined);
      if (fixture) await cdp?.call("Target.closeTarget", { targetId: fixture.targetId }).catch(() => undefined);
      await cdp?.close().catch(() => undefined);
      const browserStopped = await stopProcess(browser);
      const backendStopped = await stopProcess(backendProcess);
      const fixtureServerClosed = await closeServer(server);
      await sleep(500);
      const cleanup = await removeWithRetry(profilePath);
      if (!cleanup.removed) {
        console.warn("Warning: could not remove temporary browser profile");
      }
      report = {
        ...report,
        finishedAt: new Date().toISOString(),
        fixturePort: fixturePort ?? null,
        errorCode: failureCode ?? undefined,
        artifactStatus: Object.values(screenshotCaptured).every(Boolean) ? "complete" : "incomplete",
        diagnostics: {
          pageErrorCount: pageErrors.length,
          consoleErrorCount: consoleErrors.length,
          logErrorCount: logErrors.length,
        },
        cleanup: {
          profileRemoved: cleanup.removed,
          browserStopped,
          backendStopped,
          fixtureServerClosed,
          staleArtifactsRemoved: artifactReset.failureCount === 0,
        },
      };
      try {
        mkdirSync(dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      } catch {
        process.exitCode = 1;
        console.warn("Warning: could not write E2E report");
      }
    }
}

main().catch((error) => {
  // The classification alone cannot be acted on; the assertion that failed is
  // what a reader needs. It names an expectation, not page content.
  console.error(JSON.stringify({
    result: "failed",
    errorCode: classifyFailure(error),
    reason: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400),
  }));
  process.exitCode = 1;
});
