import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { validateRealCorpus } from "./real-corpus-preflight.mjs";
import { classifyFailure, readTraceMetadata, removeOwnedArtifacts } from "./trace-metadata.mjs";
import { taskkillCommand } from "./process-tree.mjs";
import { findChrome } from "./chrome.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const extensionRoot = join(repositoryRoot, ".output", "chrome-mv3");
const defaultCorpusRoot = join(repositoryRoot, "fixtures", "real-corpus");
const reportPath = process.env.LAYOUT_TRANSLATE_REAL_CORPUS_REPORT
  ?? join(repositoryRoot, ".output", "real-corpus-calibration-report.json");
const artifactDir = process.env.LAYOUT_TRANSLATE_REAL_CORPUS_ARTIFACT_DIR
  ?? join(repositoryRoot, ".output", "real-corpus-calibration");

const CDP_CALL_TIMEOUT_MS = 20_000;
const SCREENSHOT_TIMEOUT_MS = 5_000;
const SCREENSHOT_RETRY_COUNT = 2;
const SCREENSHOT_RETRY_DELAY_MS = 250;
const CLEANUP_TIMEOUT_MS = 5_000;
const PROVISIONAL_HARD_SHIFT_TOLERANCE_PX = 5;

function assert(condition, message) {
  if (!condition) throw new Error(`Real corpus calibration assertion failed: ${message}`);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseMode() {
  const value = process.argv.find((argument) => argument.startsWith("--mode="))?.slice("--mode=".length) ?? "both";
  assert(["baseline", "translation", "both"].includes(value), `unsupported mode ${value}`);
  return value;
}

function parseCorpusRoot() {
  const explicit = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  return resolve(explicit ?? process.env.LAYOUT_TRANSLATE_REAL_CORPUS_ROOT ?? defaultCorpusRoot);
}

function safeSlug(value) {
  return String(value).replace(/[^a-z0-9_-]+/giu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "corpus";
}

function readManifest(corpusRoot) {
  return JSON.parse(readFileSync(join(corpusRoot, "manifest.json"), "utf8"));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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
      execFileSync(taskkillCommand(), ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: CLEANUP_TIMEOUT_MS });
    } catch {
      // The process may have exited between the status check and taskkill.
    }
  } else {
    child.kill("SIGTERM");
  }
  return waitForProcessExit(child);
}

async function closeServer(server) {
  if (!server?.listening) return true;
  return Promise.race([
    new Promise((resolvePromise) => server.close((error) => resolvePromise(!error))),
    sleep(CLEANUP_TIMEOUT_MS).then(() => false),
  ]);
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

async function waitFor(predicate, description, timeout = 15_000) {
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


function startCorpusServer(corpusRoot, allowedFiles) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestedPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "").replaceAll("\\", "/");
    if (requestedPath === "favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const filePath = resolve(corpusRoot, requestedPath);
    const relativePath = relative(corpusRoot, filePath).replaceAll("\\", "/");
    if (!allowedFiles.has(relativePath) || !filePath.startsWith(`${corpusRoot}${sep}`) || !existsSync(filePath)) {
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
    response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
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
        resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
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
    try { this.webSocket.close(); } catch { /* socket may already be closed */ }
  }
}

async function connectCdp(port) {
  assert(typeof WebSocket === "function", "Node 22+ with built-in WebSocket is required");
  const version = await waitFor(() => fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json()), "Chrome CDP");
  const webSocket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    webSocket.addEventListener("open", resolvePromise, { once: true });
    webSocket.addEventListener("error", reject, { once: true });
  });
  return new CdpClient(webSocket);
}

async function evaluate(cdp, target, expression) {
  const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, target.sessionId);
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
      await waitFor(() => evaluate(cdp, popup, "Boolean(document.querySelector('main.popup-shell'))"), `extension popup for ${extensionId}`);
      return popup;
    } catch {
      await cdp.call("Target.closeTarget", { targetId: popup.targetId });
    }
  }
  throw new Error("Could not identify the built extension popup target");
}

async function captureScreenshot(cdp, target, path) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, target.sessionId, SCREENSHOT_TIMEOUT_MS);
  assert(result?.data, `Chrome did not return screenshot data for ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(result.data, "base64"));
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

function rectDelta(before, after) {
  if (!before || !after) return null;
  return {
    shift: Math.hypot(after.left - before.left, after.top - before.top),
    widthDelta: after.width - before.width,
    heightDelta: after.height - before.height,
  };
}

async function captureGeometry(cdp, page, manifest) {
  const targets = manifest.calibration.targets;
  return evaluate(cdp, page, `(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
    };
    const targets = ${JSON.stringify(targets)};
    const overflowOffenders = [...document.querySelectorAll("*")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 20)
      .map((element) => ({ tag: element.tagName.toLowerCase(), id: element.id || null, className: typeof element.className === "string" ? element.className : null, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, right: element.getBoundingClientRect().right }));
    return {
      targets: Object.fromEntries(targets.map((target) => [target.name, { anchor: rect(target.anchorSelector), sibling: rect(target.siblingSelector) }])),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      overflowOffenders,
    };
  })()`);
}

function validateGeometryPresence(geometry, manifest, viewport) {
  const failures = [];
  for (const target of manifest.calibration.targets) {
    const measurement = geometry.targets?.[target.name];
    if (!measurement?.anchor) failures.push(`${target.name}:anchor_missing`);
    if (!measurement?.sibling) failures.push(`${target.name}:sibling_missing`);
  }
  if (viewport.pageOverflowPolicy === "hard" && geometry.pageOverflow !== false) failures.push("page_overflow");
  return failures;
}

async function preparePage(cdp, page, viewport, manifest) {
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
  const firstTarget = manifest.calibration.targets[0];
  await waitFor(() => evaluate(cdp, page, `Boolean(document.querySelector(${JSON.stringify(firstTarget.anchorSelector)}))`), "corpus entrypoint");
  await evaluate(cdp, page, "document.fonts?.ready");
}

async function waitForTranslationCases(cdp, page, cases, locale, popup) {
  for (const translationCase of cases) {
    const expected = locale === "source" ? translationCase.source : translationCase[locale];
    try {
      await waitFor(
        () => evaluate(cdp, page, `document.querySelector(${JSON.stringify(translationCase.selector)})?.textContent?.trim() === ${JSON.stringify(expected)}`),
        `${translationCase.name} ${locale} translation`,
      );
    } catch (error) {
      const pageDiagnostics = await evaluate(cdp, page, `(() => {
        const selectors = ${JSON.stringify(cases.map((item) => item.selector))};
        const expectedValues = ${JSON.stringify(cases.map((item) => locale === "source" ? item.source : item[locale]))};
        return {
          matched: selectors.filter((selector, index) => document.querySelector(selector)?.textContent?.trim() === expectedValues[index]).length,
          total: selectors.length,
          states: selectors.map((selector) => {
            const text = document.querySelector(selector)?.textContent?.trim() ?? "";
            return { length: text.length, japanese: /[\\u3040-\\u30ff\\u3400-\\u9fff]/u.test(text) };
          }),
        };
      })()`).catch(() => ({ matched: null, total: cases.length }));
      const popupDiagnostics = popup
        ? await evaluate(cdp, popup, "(async () => { const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' }); return { status: document.querySelector('.status-panel strong')?.textContent ?? null, toggleDisabled: document.querySelector('button.toggle')?.disabled ?? null, togglePressed: document.querySelector('button.toggle')?.getAttribute('aria-pressed') ?? null, runtimeStatus: response?.state?.status ?? null, translatedAnchors: response?.state?.translatedAnchors ?? null, lastError: response?.state?.lastError ?? null }; })()").catch(() => null)
        : null;
      throw new Error(`${error instanceof Error ? error.message : String(error)}; matched=${pageDiagnostics.matched}/${pageDiagnostics.total}; states=${JSON.stringify(pageDiagnostics.states ?? null)}; popup=${JSON.stringify(popupDiagnostics)}`);
    }
  }
}

async function runBrowserMode({ mode, corpusRoot, manifest, preflight }) {
  const translationEnabled = mode === "translation";
  if (translationEnabled || mode === "both") assert(existsSync(extensionRoot), "built extension is missing; run `npm run build` first");
  const chromePath = findChrome();
  const cdpPort = await findFreePort();
  const profilePath = mkdtempSync(join(tmpdir(), "layout-translate-real-corpus-"));
  const allowedFiles = new Set(preflight.files);
  const server = startCorpusServer(corpusRoot, allowedFiles);
  const cases = [];
  const gateFailures = [];
  const screenshotFailures = [];
  const backendTrace = { stdoutLineCount: 0, stderrLineCount: 0, responseCount: 0, lastStdoutLines: [] };
  let browser;
  let backendProcess;
  let cdp;
  let fixturePort;
  let backendPort;
  const expectedScreenshots = manifest.viewports.flatMap((viewport) => {
    const prefix = `${safeSlug(mode)}-${safeSlug(viewport.name)}`;
    return translationEnabled
      ? [join(artifactDir, `${prefix}-baseline.png`), join(artifactDir, `${prefix}-en.png`), join(artifactDir, `${prefix}-vi.png`)]
      : [join(artifactDir, `${prefix}.png`)];
  });
  const artifactReset = removeOwnedArtifacts(expectedScreenshots);
  const trace = readTraceMetadata({ repositoryRoot, inputPaths: { corpus: corpusRoot }, artifactPaths: { extension: extensionRoot } });

  try {
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    fixturePort = typeof address === "object" && address ? address.port : undefined;
    assert(fixturePort, "corpus server did not expose a port");
    browser = spawn(chromePath, [
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profilePath}`,
      ...(translationEnabled ? [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`] : []),
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-default-apps",
      "--window-size=1280,900",
    ], { stdio: "ignore", windowsHide: true });
    cdp = await connectCdp(cdpPort);
    const browserVersion = await cdp.call("Browser.getVersion");

    if (translationEnabled) {
      backendPort = await findFreePort();
      const backendToken = "dev-only-token";
      const overridesPath = join(profilePath, "translation-overrides.json");
      const overrides = Object.fromEntries(manifest.calibration.translationCases.map((translationCase) => [translationCase.source, {
        en: translationCase.en,
        vi: translationCase.vi,
        ...(translationCase.compact ? { compact: translationCase.compact } : {}),
      }]));
      writeFileSync(overridesPath, `${JSON.stringify(overrides)}\n`, "utf8");
      backendProcess = spawn(process.execPath, [join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"), join(repositoryRoot, "backend", "src", "mock-server.ts")], {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          LAYOUT_TRANSLATE_MOCK_PORT: String(backendPort),
          LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN: backendToken,
          LAYOUT_TRANSLATE_ALLOWED_ORIGINS: `http://127.0.0.1:${fixturePort}`,
          LAYOUT_TRANSLATE_ALLOWED_CLIENT_ORIGINS: "",
          LAYOUT_TRANSLATE_ALLOW_EXTENSION_CLIENTS: "true",
          LAYOUT_TRANSLATE_MOCK_TRANSLATION_OVERRIDES: overridesPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      backendProcess.stdout?.setEncoding("utf8");
      backendProcess.stdout?.on("data", (chunk) => {
        const lines = String(chunk).split(/\r?\n/u).filter(Boolean);
        backendTrace.stdoutLineCount += lines.length;
        backendTrace.responseCount += lines.filter((line) => line.includes('"event":"translation_response"')).length;
        backendTrace.lastStdoutLines = [...backendTrace.lastStdoutLines, ...lines].slice(-5);
      });
      backendProcess.stderr?.setEncoding("utf8");
      backendProcess.stderr?.on("data", (chunk) => {
        backendTrace.stderrLineCount += String(chunk).split(/\r?\n/u).filter(Boolean).length;
      });
      await waitFor(() => fetch(`http://127.0.0.1:${backendPort}/v1/translate`, { method: "OPTIONS" }).then(() => true).catch(() => false), "translation backend");
    }

    for (const viewport of manifest.viewports) {
      const caseName = `${safeSlug(mode)}-${safeSlug(viewport.name)}`;
      const pageTarget = await cdp.call("Target.createTarget", { url: `http://127.0.0.1:${fixturePort}/${manifest.runtime.expectedEntry}` });
      const page = await attachTarget(cdp, pageTarget.targetId);
      const pageErrors = [];
      const consoleErrors = [];
      cdp.on("Runtime.exceptionThrown", (event) => { if (event.sessionId === page.sessionId) pageErrors.push("runtime_exception"); });
      cdp.on("Runtime.consoleAPICalled", (event) => { if (event.sessionId === page.sessionId && ["error", "assert"].includes(event.params?.type)) consoleErrors.push("console_error"); });
      try {
        await preparePage(cdp, page, viewport, manifest);
        await cdp.call("Target.activateTarget", { targetId: page.targetId });
        let popup;
        if (translationEnabled) {
          popup = await findExtensionPopup(cdp);
          await evaluate(cdp, popup, `chrome.storage.local.set({"layout-translate:backend": { url: "http://127.0.0.1:${backendPort}", token: "dev-only-token" }})`);
          await waitFor(() => evaluate(cdp, popup, "Boolean(document.querySelector('button.restore-button:not(:disabled)'))"), `${caseName} popup ready`);
          await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
          await waitForTranslationCases(cdp, page, manifest.calibration.translationCases, "source", popup);
          await waitFor(() => evaluate(cdp, popup, "document.querySelector('button.toggle')?.getAttribute('aria-pressed') === 'false'"), `${caseName} restore state`);
        }
        const baseline = await captureGeometry(cdp, page, manifest);
        const baselineFailures = validateGeometryPresence(baseline, manifest, viewport);
        const baselineScreenshot = await captureScreenshotWithRetry(cdp, page, join(artifactDir, `${caseName}${translationEnabled ? "-baseline" : ""}.png`));
        if (baselineScreenshot.error) screenshotFailures.push({ case: caseName, language: "baseline", attempts: baselineScreenshot.attempts, errorCode: classifyFailure(baselineScreenshot.error) });
        if (mode === "baseline") {
          const failures = [...baselineFailures, ...pageErrors, ...consoleErrors];
          cases.push({ name: caseName, viewport: viewport.name, dimensions: { width: viewport.width, height: viewport.height }, passed: failures.length === 0, targets: Object.keys(baseline.targets ?? {}), pageOverflow: baseline.pageOverflow, overflowOffenders: baseline.overflowOffenders, screenshot: baselineScreenshot.captured ? `${caseName}.png` : null, screenshotAttempts: baselineScreenshot.attempts, errors: { page: pageErrors.length, console: consoleErrors.length }, gateFailures: failures });
          if (failures.length > 0) gateFailures.push({ case: caseName, failures });
        } else {
          await evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(1)').click()");
          await waitFor(() => evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(1)')?.getAttribute('aria-pressed') === 'true'"), `${caseName} English selection`);
          await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
          await waitForTranslationCases(cdp, page, manifest.calibration.translationCases, "en", popup);
          const english = await captureGeometry(cdp, page, manifest);
          const englishScreenshot = await captureScreenshotWithRetry(cdp, page, join(artifactDir, `${caseName}-en.png`));
          if (englishScreenshot.error) screenshotFailures.push({ case: caseName, language: "en", attempts: englishScreenshot.attempts, errorCode: classifyFailure(englishScreenshot.error) });
          await evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(2)').click()");
          await waitFor(() => evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(2)')?.getAttribute('aria-pressed') === 'true'"), `${caseName} Vietnamese selection`);
          await waitForTranslationCases(cdp, page, manifest.calibration.translationCases, "vi", popup);
          const vietnamese = await captureGeometry(cdp, page, manifest);
          const vietnameseScreenshot = await captureScreenshotWithRetry(cdp, page, join(artifactDir, `${caseName}-vi.png`));
          if (vietnameseScreenshot.error) screenshotFailures.push({ case: caseName, language: "vi", attempts: vietnameseScreenshot.attempts, errorCode: classifyFailure(vietnameseScreenshot.error) });
          const languageResult = (geometry) => ({
            pageOverflow: geometry.pageOverflow,
            overflowOffenders: geometry.overflowOffenders,
            targets: Object.fromEntries(manifest.calibration.targets.map((target) => [target.name, rectDelta(baseline.targets?.[target.name]?.anchor, geometry.targets?.[target.name]?.anchor)])),
            siblingTargets: Object.fromEntries(manifest.calibration.targets.map((target) => [target.name, rectDelta(baseline.targets?.[target.name]?.sibling, geometry.targets?.[target.name]?.sibling)])),
          });
          const englishResult = languageResult(english);
          const vietnameseResult = languageResult(vietnamese);
          const failures = [...baselineFailures, ...validateGeometryPresence(english, manifest, viewport), ...validateGeometryPresence(vietnamese, manifest, viewport), ...pageErrors, ...consoleErrors];
          for (const target of manifest.calibration.targets) {
            if (target.desktopHardGate !== true || viewport.name !== "desktop") continue;
            for (const [language, result] of [["en", englishResult], ["vi", vietnameseResult]]) {
              const anchorShift = result.targets[target.name]?.shift;
              const siblingShift = result.siblingTargets[target.name]?.shift;
              if (anchorShift === null || anchorShift === undefined || anchorShift > PROVISIONAL_HARD_SHIFT_TOLERANCE_PX) failures.push(`${language}_${target.name}_anchor_shift`);
              if (siblingShift === null || siblingShift === undefined || siblingShift > PROVISIONAL_HARD_SHIFT_TOLERANCE_PX) failures.push(`${language}_${target.name}_sibling_shift`);
            }
          }
          cases.push({ name: caseName, viewport: viewport.name, dimensions: { width: viewport.width, height: viewport.height }, passed: failures.length === 0, targets: Object.keys(baseline.targets ?? {}), baseline: { pageOverflow: baseline.pageOverflow }, english: englishResult, vietnamese: vietnameseResult, screenshots: { baseline: baselineScreenshot.captured ? `${caseName}-baseline.png` : null, english: englishScreenshot.captured ? `${caseName}-en.png` : null, vietnamese: vietnameseScreenshot.captured ? `${caseName}-vi.png` : null }, screenshotAttempts: { baseline: baselineScreenshot.attempts, english: englishScreenshot.attempts, vietnamese: vietnameseScreenshot.attempts }, errors: { page: pageErrors.length, console: consoleErrors.length }, gateFailures: failures });
          if (failures.length > 0) gateFailures.push({ case: caseName, failures });
          await cdp.call("Target.closeTarget", { targetId: popup.targetId });
        }
      } finally {
        await cdp.call("Target.closeTarget", { targetId: page.targetId }).catch(() => undefined);
      }
    }
    return {
      result: gateFailures.length === 0 ? "passed" : "failed",
      mode,
      caseCount: cases.length,
      cases,
      gateFailures,
      screenshotFailures,
      trace: {
        ...trace,
        operationTimeoutMs: CDP_CALL_TIMEOUT_MS,
        screenshotTimeoutMs: SCREENSHOT_TIMEOUT_MS,
        screenshotRetryCount: SCREENSHOT_RETRY_COUNT,
        screenshotRetryDelayMs: SCREENSHOT_RETRY_DELAY_MS,
        browser: { executable: chromePath.split(/[\\/]/u).pop() ?? "chrome", product: browserVersion.product ?? null, revision: browserVersion.revision ?? null },
        backend: backendTrace,
      },
      cleanup: { staleArtifactsRemoved: artifactReset.failureCount === 0 },
    };
  } catch (error) {
    if (error && typeof error === "object") error.backendTrace = backendTrace;
    throw error;
  } finally {
    cdp?.close();
    const browserStopped = await stopProcess(browser);
    const backendStopped = await stopProcess(backendProcess);
    const fixtureServerClosed = await closeServer(server);
    await sleep(250);
    try { rmSync(profilePath, { recursive: true, force: true }); } catch { /* cleanup is reported */ }
    // The caller records the final cleanup state without retaining the temp profile path.
    if (!browserStopped || !backendStopped || !fixtureServerClosed) {
      console.warn(JSON.stringify({ event: "real_corpus_cleanup_warning", browserStopped, backendStopped, fixtureServerClosed }));
    }
  }
}

async function main() {
  const mode = parseMode();
  const corpusRoot = parseCorpusRoot();
  const startedAt = new Date().toISOString();
  const preflight = validateRealCorpus(corpusRoot, { mode });
  const baseReport = {
    schema: "layout-translate/real-corpus-calibration/v1",
    mode,
    startedAt,
    corpus: preflight.manifest,
    preflight,
    provisionalHardShiftTolerancePx: PROVISIONAL_HARD_SHIFT_TOLERANCE_PX,
    cases: [],
    gateFailures: [],
    screenshotFailures: [],
  };
  if (!preflight.ok) {
    const report = { ...baseReport, result: "blocked", reason: "preflight_failed", finishedAt: new Date().toISOString() };
    writeReport(report);
    console.log(JSON.stringify({ result: report.result, mode, errorCodes: preflight.errors.map((error) => error.code) }, null, 2));
    process.exitCode = 1;
    return;
  }

  const manifest = readManifest(corpusRoot);
  const modes = mode === "both" ? ["baseline", "translation"] : [mode];
  const modeReports = [];
  try {
    for (const currentMode of modes) modeReports.push(await runBrowserMode({ mode: currentMode, corpusRoot, manifest, preflight }));
    const allFailures = modeReports.flatMap((item) => item.gateFailures);
    const report = {
      ...baseReport,
      result: allFailures.length === 0 ? "passed" : "failed",
      finishedAt: new Date().toISOString(),
      modes: modeReports,
      cases: modeReports.flatMap((item) => item.cases),
      gateFailures: allFailures,
      screenshotFailures: modeReports.flatMap((item) => item.screenshotFailures),
    };
    writeReport(report);
    console.log(JSON.stringify({ result: report.result, mode, caseCount: report.cases.length, failedCases: allFailures.length }, null, 2));
    if (report.result !== "passed") process.exitCode = 1;
  } catch (error) {
    const report = {
      ...baseReport,
      result: "failed",
      reason: classifyFailure(error),
      errorCode: classifyFailure(error),
      error: error instanceof Error ? error.message : String(error),
      modes: modeReports,
      cases: modeReports.flatMap((item) => item.cases),
      gateFailures: modeReports.flatMap((item) => item.gateFailures),
      screenshotFailures: modeReports.flatMap((item) => item.screenshotFailures),
      ...(error && typeof error === "object" && "backendTrace" in error ? { backend: error.backendTrace } : {}),
      finishedAt: new Date().toISOString(),
    };
    writeReport(report);
    console.error(JSON.stringify({ result: report.result, mode, errorCode: report.errorCode }));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const errorCode = classifyFailure(error);
  try {
    writeReport({ schema: "layout-translate/real-corpus-calibration/v1", result: "failed", errorCode, error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
  } catch {
    // Preserve the original process failure when report writing is unavailable.
  }
  console.error(JSON.stringify({ result: "failed", errorCode }));
  process.exitCode = 1;
});
