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
  readTraceMetadata,
  removeOwnedArtifacts,
} from "./trace-metadata.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const extensionRoot = join(repositoryRoot, ".output", "chrome-mv3");
const reportPath = process.env.LAYOUT_TRANSLATE_CALIBRATION_REPORT
  ?? join(repositoryRoot, ".output", "calibration-report.json");
const artifactDir = process.env.LAYOUT_TRANSLATE_CALIBRATION_ARTIFACT_DIR
  ?? join(repositoryRoot, ".output", "calibration");
const hardShiftTolerancePx = 5;
const CDP_CALL_TIMEOUT_MS = 20_000;
const SCREENSHOT_TIMEOUT_MS = 5_000;
const SCREENSHOT_RETRY_COUNT = 2;
const SCREENSHOT_RETRY_DELAY_MS = 250;
const CLEANUP_TIMEOUT_MS = 5_000;

function browserTraceName(chromePath) {
  return chromePath.split(/[\\\\/]/u).pop() ?? "chrome";
}

const fixtures = [
  {
    name: "flex-intrinsic",
    path: "/fixtures/calibration/flex-intrinsic.html",
    source: "確認して送信",
    english: "Review and send",
    vietnamese: "Xem lại và gửi",
    anchor: "[data-calibration='critical']",
    sibling: "[data-calibration='nav']",
    context: ".calibration-title",
    layout: ".calibration-row",
    footer: ".calibration-footer",
    hardGate: true,
  },
  {
    name: "grid-table",
    path: "/fixtures/calibration/grid-table.html",
    source: "確認して送信",
    english: "Review and send",
    vietnamese: "Xem lại và gửi",
    anchor: "[data-calibration='anchor']",
    sibling: "[data-calibration='nav']",
    context: ".calibration-title",
    layout: ".calibration-grid",
    footer: ".calibration-footer",
    hardGate: true,
    table: "[data-calibration='table']",
    grid: "[data-calibration='grid']",
    card: "[data-calibration='card']",
    tableCard: "[data-calibration='table-card']",
  },
  {
    name: "long-form",
    path: "/fixtures/calibration/long-form.html",
    source: "説明文",
    english: "Description",
    vietnamese: "Mô tả",
    anchor: "[data-calibration='anchor']",
    sibling: "[data-calibration='nav']",
    context: "[data-calibration='paragraph']",
    layout: ".calibration-long",
    footer: ".calibration-footer",
    hardGate: false,
    paragraph: "[data-calibration='paragraph']",
  },
];

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

function assert(condition, message) {
  if (!condition) throw new Error(`Calibration assertion failed: ${message}`);
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
      execFileSync(taskkillCommand(), ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: CLEANUP_TIMEOUT_MS,
      });
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
  assert(port, "could not allocate a local calibration port");
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
    const filePath = resolve(repositoryRoot, relativePath);
    if (!(filePath === repositoryRoot || filePath.startsWith(`${repositoryRoot}${sep}`)) || !existsSync(filePath)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const body = readFileSync(filePath);
    const contentType = filePath.endsWith(".html")
      ? "text/html; charset=utf-8"
      : filePath.endsWith(".css")
        ? "text/css; charset=utf-8"
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
  }

  call(method, params = {}, sessionId, timeoutMs = CDP_CALL_TIMEOUT_MS) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.webSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  close() {
    try {
      this.webSocket.close();
    } catch {
      // The socket may already be closed during failure cleanup.
    }
  }
}

async function connectCdp(port) {
  assert(typeof WebSocket === "function", "Node 22+ with built-in WebSocket is required");
  const version = await waitFor(
    () => fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()),
    "Chrome CDP",
  );
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
  return result.result?.value;
}

async function attachTarget(cdp, targetId) {
  const attached = await cdp.call("Target.attachToTarget", { targetId, flatten: true });
  return { targetId, sessionId: attached.sessionId };
}

async function findExtensionPopup(cdp) {
  const targets = await cdp.call("Target.getTargets");
  const extensionIds = targets.targetInfos
    .filter((target) => target.type === "service_worker" && target.url.endsWith("/background.js"))
    .map((target) => target.url.slice("chrome-extension://".length).split("/")[0]);
  for (const extensionId of extensionIds) {
    const target = await cdp.call("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html` });
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

async function captureScreenshot(cdp, target, path) {
  const result = await cdp.call(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    target.sessionId,
    SCREENSHOT_TIMEOUT_MS,
  );
  assert(result?.data, `Chrome did not return screenshot data for ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(result.data, "base64"));
  return true;
}

async function captureScreenshotWithRetry(cdp, target, path) {
  let lastError;
  const maxAttempts = SCREENSHOT_RETRY_COUNT + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    removeOwnedArtifacts([path]);
    try {
      await captureScreenshot(cdp, target, path);
      return { captured: true, attempts: attempt, error: null };
    } catch (error) {
      lastError = error;
      removeOwnedArtifacts([path]);
      if (attempt < maxAttempts) await sleep(SCREENSHOT_RETRY_DELAY_MS * attempt);
    }
  }
  return { captured: false, attempts: maxAttempts, error: lastError };
}

async function captureSnapshot(cdp, target, fixture) {
  return evaluate(
    cdp,
    target,
    `(() => {
      const rect = (selector) => {
        if (!selector) return null;
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        };
      };
      const lineCount = (selector) => {
        if (!selector) return null;
        const element = document.querySelector(selector);
        if (!element) return null;
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      };
      const children = (selector) => {
        if (!selector) return null;
        const element = document.querySelector(selector);
        if (!element) return null;
        return [...element.children].map((child) => {
          const box = child.getBoundingClientRect();
          const style = getComputedStyle(child);
          return {
            tag: child.tagName.toLowerCase(),
            className: child.className || null,
            top: box.top,
            width: box.width,
            height: box.height,
            scrollHeight: child.scrollHeight,
            clientHeight: child.clientHeight,
            cssHeight: style.height,
            cssMaxHeight: style.maxHeight,
            overflow: style.overflow,
            textLength: child.textContent?.length ?? 0,
          };
        });
      };
      return {
        anchor: rect(${JSON.stringify(fixture.anchor)}),
        sibling: rect(${JSON.stringify(fixture.sibling)}),
        nav: rect("[data-calibration='nav']"),
        context: rect(${JSON.stringify(fixture.context ?? null)}),
        layout: rect(${JSON.stringify(fixture.layout ?? null)}),
        footer: rect(${JSON.stringify(fixture.footer ?? null)}),
        grid: rect(${JSON.stringify(fixture.grid ?? null)}),
        card: rect(${JSON.stringify(fixture.card ?? null)}),
        cardChildren: children(${JSON.stringify(fixture.card ?? null)}),
        tableCard: rect(${JSON.stringify(fixture.tableCard ?? null)}),
        table: rect(${JSON.stringify(fixture.table ?? null)}),
        paragraph: rect(${JSON.stringify(fixture.paragraph ?? null)}),
        paragraphLineCount: lineCount(${JSON.stringify(fixture.paragraph ?? null)}),
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    })()`,
  );
}

function shift(before, after) {
  if (!before || !after) return null;
  return Math.hypot(after.left - before.left, after.top - before.top);
}

function widthDelta(before, after) {
  if (!before || !after) return null;
  return after.width - before.width;
}

function heightDelta(before, after) {
  if (!before || !after) return null;
  return after.height - before.height;
}

async function main() {
  assert(existsSync(extensionRoot), "built extension is missing; run `npm run build` first");
  const chromePath = findChrome();
  const cdpPort = await findFreePort();
  const profilePath = mkdtempSync(join(tmpdir(), "layout-translate-calibration-"));
  const server = startFixtureServer();
  const startedAt = new Date().toISOString();
  const expectedScreenshotPaths = fixtures.flatMap((fixture) => viewports.flatMap((viewport) => [
    join(artifactDir, `${fixture.name}-${viewport.name}-en.png`),
    join(artifactDir, `${fixture.name}-${viewport.name}-vi.png`),
  ]));
  const artifactReset = removeOwnedArtifacts([reportPath, ...expectedScreenshotPaths]);
  const traceMetadata = readTraceMetadata({
    repositoryRoot,
    artifactPaths: { extension: extensionRoot },
  });
  let browser;
  let backendProcess;
  let cdp;
  let fixturePort;
  let failureCode;
  const cases = [];
  const gateFailures = [];
  const screenshotFailures = [];
  const backendTrace = { stderrLineCount: 0 };
  let report = {
    schema: "layout-translate/calibration-report/v1",
    result: "failed",
    startedAt,
    node: process.version,
    trace: {
      ...traceMetadata,
      operationTimeoutMs: CDP_CALL_TIMEOUT_MS,
      screenshotTimeoutMs: SCREENSHOT_TIMEOUT_MS,
      screenshotRetryCount: SCREENSHOT_RETRY_COUNT,
      screenshotRetryDelayMs: SCREENSHOT_RETRY_DELAY_MS,
      cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
      browser: { executable: browserTraceName(chromePath), product: null, revision: null },
      backend: backendTrace,
    },
    corpus: fixtures.map((fixture) => fixture.name),
    viewports: viewports.map((viewport) => viewport.name),
    provisionalHardShiftTolerancePx: hardShiftTolerancePx,
  };

  try {
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    fixturePort = typeof address === "object" && address ? address.port : undefined;
    assert(fixturePort, "calibration server did not expose a port");
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
        ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,900",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    cdp = await connectCdp(cdpPort);
    const browserVersion = await cdp.call("Browser.getVersion");
    report.trace.browser = {
      executable: browserTraceName(chromePath),
      product: browserVersion.product ?? null,
      revision: browserVersion.revision ?? null,
    };

    const backendPort = await findFreePort();
    const backendToken = "dev-only-token";
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
        },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    backendProcess.stderr?.setEncoding("utf8");
    backendProcess.stderr?.on("data", (chunk) => {
      backendTrace.stderrLineCount += String(chunk).split(/\r?\n/u).filter(Boolean).length;
    });
    await waitFor(
      () => fetch(`http://127.0.0.1:${backendPort}/v1/translate`, { method: "OPTIONS" }).then(() => true).catch(() => false),
      "mock backend",
    );

    for (const fixture of fixtures) {
      for (const viewport of viewports) {
        const caseName = `${fixture.name}-${viewport.name}`;
        const pageTarget = await cdp.call("Target.createTarget", {
          url: `http://127.0.0.1:${fixturePort}${fixture.path}`,
        });
        const page = await attachTarget(cdp, pageTarget.targetId);
        const pageErrors = [];
        const consoleErrors = [];
        const logErrors = [];
        cdp.on("Runtime.exceptionThrown", (event) => {
          if (event.sessionId === page.sessionId) {
            pageErrors.push("runtime_exception");
          }
        });
        cdp.on("Runtime.consoleAPICalled", (event) => {
          if (event.sessionId === page.sessionId && ["error", "assert"].includes(event.params?.type)) {
            consoleErrors.push(event.params.type === "assert" ? "console_assert" : "console_error");
          }
        });
        cdp.on("Log.entryAdded", (event) => {
          if (event.sessionId === page.sessionId && event.params?.entry?.level === "error") {
            logErrors.push("browser_log_error");
          }
        });
        await cdp.call("Runtime.enable", {}, page.sessionId);
        await cdp.call("Log.enable", {}, page.sessionId);
        await cdp.call("Page.enable", {}, page.sessionId);
        await cdp.call("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false,
        }, page.sessionId);
        await cdp.call("Page.reload", { ignoreCache: true }, page.sessionId);
        await waitFor(
          () => evaluate(cdp, page, `Boolean(document.querySelector(${JSON.stringify(fixture.anchor)}))`),
          `${caseName} fixture content`,
        );
        await evaluate(cdp, page, "document.fonts?.ready");
        await cdp.call("Target.activateTarget", { targetId: page.targetId });
        const popup = await findExtensionPopup(cdp);
        await evaluate(cdp, popup, `chrome.storage.local.set({"layout-translate:backend": { url: "http://127.0.0.1:${backendPort}", token: "${backendToken}" }})`);
        await waitFor(
          () => evaluate(cdp, popup, "Boolean(document.querySelector('button.restore-button:not(:disabled)'))"),
          `${caseName} popup ready`,
        );
        await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
        await waitFor(
          () => evaluate(cdp, page, `document.querySelector(${JSON.stringify(fixture.anchor)})?.textContent === ${JSON.stringify(fixture.source)}`),
          `${caseName} source restore before baseline`,
        );
        await waitFor(
          () => evaluate(cdp, popup, "document.querySelector('button.toggle')?.getAttribute('aria-pressed') === 'false' && !document.querySelector('.language-switch button:nth-child(1)')?.disabled"),
          `${caseName} popup restore state`,
        );
        const baseline = await captureSnapshot(cdp, page, fixture);
        await evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(1)').click()");
        await waitFor(
          () => evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(1)')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('.language-switch button:nth-child(1)')?.disabled"),
          `${caseName} English selection`,
        );
        await waitFor(
          () => evaluate(cdp, popup, "document.querySelector('button.toggle')?.getAttribute('aria-pressed') === 'false'"),
          `${caseName} restore state`,
        );
        await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
        await waitFor(
          () => evaluate(cdp, page, `document.querySelector(${JSON.stringify(fixture.anchor)})?.textContent === ${JSON.stringify(fixture.english)}`),
          `${caseName} English translation`,
        );
        const english = await captureSnapshot(cdp, page, fixture);
        const englishScreenshot = join(artifactDir, `${caseName}-en.png`);
        const englishScreenshotResult = await captureScreenshotWithRetry(cdp, page, englishScreenshot);
        const englishScreenshotCaptured = englishScreenshotResult.captured;
        if (englishScreenshotResult.error) {
          screenshotFailures.push({
            case: caseName,
            language: "en",
            attempts: englishScreenshotResult.attempts,
            errorCode: classifyFailure(englishScreenshotResult.error),
          });
        }
        await evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(2)').click()");
        await waitFor(
          () => evaluate(cdp, page, `document.querySelector(${JSON.stringify(fixture.anchor)})?.textContent === ${JSON.stringify(fixture.vietnamese)}`),
          `${caseName} Vietnamese translation`,
        );
        const vietnamese = await captureSnapshot(cdp, page, fixture);
        const vietnameseScreenshot = join(artifactDir, `${caseName}-vi.png`);
        const vietnameseScreenshotResult = await captureScreenshotWithRetry(cdp, page, vietnameseScreenshot);
        const vietnameseScreenshotCaptured = vietnameseScreenshotResult.captured;
        if (vietnameseScreenshotResult.error) {
          screenshotFailures.push({
            case: caseName,
            language: "vi",
            attempts: vietnameseScreenshotResult.attempts,
            errorCode: classifyFailure(vietnameseScreenshotResult.error),
          });
        }
        const result = {
          name: caseName,
          fixture: fixture.name,
          viewport: viewport.name,
          dimensions: { width: viewport.width, height: viewport.height },
          shiftGateApplied: fixture.hardGate === true && viewport.name === "desktop",
          passed: true,
          english: {
            anchorShift: shift(baseline.anchor, english.anchor),
            siblingShift: shift(baseline.sibling, english.sibling),
            anchorWidthDelta: widthDelta(baseline.anchor, english.anchor),
            contextHeightDelta: heightDelta(baseline.context, english.context),
            layoutHeightDelta: heightDelta(baseline.layout, english.layout),
            cardHeightDelta: heightDelta(baseline.card, english.card),
            tableCardHeightDelta: heightDelta(baseline.tableCard, english.tableCard),
            footerTopShift: english.footer && baseline.footer ? english.footer.top - baseline.footer.top : null,
            pageOverflow: english.pageOverflow,
            paragraphLineCount: english.paragraphLineCount,
          },
          vietnamese: {
            anchorShift: shift(baseline.anchor, vietnamese.anchor),
            siblingShift: shift(baseline.sibling, vietnamese.sibling),
            anchorWidthDelta: widthDelta(baseline.anchor, vietnamese.anchor),
            contextHeightDelta: heightDelta(baseline.context, vietnamese.context),
            layoutHeightDelta: heightDelta(baseline.layout, vietnamese.layout),
            cardHeightDelta: heightDelta(baseline.card, vietnamese.card),
            tableCardHeightDelta: heightDelta(baseline.tableCard, vietnamese.tableCard),
            footerTopShift: vietnamese.footer && baseline.footer ? vietnamese.footer.top - baseline.footer.top : null,
            pageOverflow: vietnamese.pageOverflow,
            paragraphLineCount: vietnamese.paragraphLineCount,
          },
          screenshots: {
            english: englishScreenshotCaptured ? `${caseName}-en.png` : null,
            vietnamese: vietnameseScreenshotCaptured ? `${caseName}-vi.png` : null,
          },
          screenshotAttempts: {
            english: englishScreenshotResult.attempts,
            vietnamese: vietnameseScreenshotResult.attempts,
          },
          errors: {
            page: pageErrors.length,
            console: consoleErrors.length,
            log: logErrors.length,
          },
          debug: fixture.card
            ? {
                baselineCardChildren: baseline.cardChildren,
                englishCardChildren: english.cardChildren,
                vietnameseCardChildren: vietnamese.cardChildren,
              }
            : undefined,
        };
        const failures = [];
        if (result.english.pageOverflow !== false) failures.push("english_page_overflow");
        if (result.vietnamese.pageOverflow !== false) failures.push("vietnamese_page_overflow");
        if (fixture.hardGate === true && viewport.name === "desktop") {
          if (result.english.anchorShift > hardShiftTolerancePx) failures.push("english_anchor_shift");
          if (result.vietnamese.anchorShift > hardShiftTolerancePx) failures.push("vietnamese_anchor_shift");
          if (result.english.siblingShift > hardShiftTolerancePx) failures.push("english_sibling_shift");
          if (result.vietnamese.siblingShift > hardShiftTolerancePx) failures.push("vietnamese_sibling_shift");
        }
        if (pageErrors.length > 0) failures.push("page_errors");
        if (consoleErrors.length > 0) failures.push("console_errors");
        if (logErrors.length > 0) failures.push("browser_log_errors");
        result.passed = failures.length === 0;
        result.gateFailures = failures;
        if (failures.length > 0) gateFailures.push({ case: caseName, failures });
        cases.push(result);
        await cdp.call("Target.closeTarget", { targetId: popup.targetId });
        await cdp.call("Target.closeTarget", { targetId: page.targetId });
      }
    }
    report = {
      ...report,
      result: gateFailures.length === 0 ? "passed" : "failed",
      artifactStatus: screenshotFailures.length === 0 ? "complete" : "partial",
    };
    report.fixturePort = fixturePort;
    report.caseCount = cases.length;
    report.cases = cases;
    report.gateFailures = gateFailures;
    report.screenshotFailures = screenshotFailures;
    console.log(JSON.stringify({ result: report.result, caseCount: cases.length, failedCases: gateFailures.length, maxAnchorShift: Math.max(...cases.flatMap((item) => [item.english.anchorShift, item.vietnamese.anchorShift])), maxSiblingShift: Math.max(...cases.flatMap((item) => [item.english.siblingShift, item.vietnamese.siblingShift])) }, null, 2));
    if (gateFailures.length > 0) process.exitCode = 1;
  } catch (error) {
    failureCode = classifyFailure(error);
    throw error;
  } finally {
    cdp?.close();
    const browserStopped = await stopProcess(browser);
    const backendStopped = await stopProcess(backendProcess);
    const fixtureServerClosed = await closeServer(server);
    await sleep(250);
    const cleanup = await removeWithRetry(profilePath);
    const finalReport = {
      ...report,
      finishedAt: new Date().toISOString(),
      fixturePort: fixturePort ?? null,
      errorCode: failureCode ?? undefined,
      cleanup: {
        profileRemoved: cleanup.removed,
        browserStopped,
        backendStopped,
        fixtureServerClosed,
        staleArtifactsRemoved: artifactReset.failureCount === 0,
      },
      screenshotFailures,
      ...(cases.length > 0 ? { cases } : {}),
    };
    try {
      mkdirSync(dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
    } catch {
      process.exitCode = 1;
      console.warn("Warning: could not write calibration report");
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ result: "failed", errorCode: classifyFailure(error) }));
  process.exitCode = 1;
});
