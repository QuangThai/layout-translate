// Runs the built extension against a local Japanese fixture with a REAL
// translation provider, so provider quality and layout behaviour can be
// observed together. This is developer verification per
// docs/decisions/0005-live-site-developer-verification.md; it is not a gate and
// produces no calibration evidence.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { taskkillCommand } from "./process-tree.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const extensionRoot = join(repositoryRoot, ".output", "chrome-mv3");
const corpusRoot = join(repositoryRoot, "fixtures", "real-corpus");
const reportPath = process.env.LAYOUT_TRANSLATE_LIVE_REPORT
  ?? join(repositoryRoot, ".output", "live-provider-report.json");
const artifactDir = process.env.LAYOUT_TRANSLATE_LIVE_ARTIFACT_DIR
  ?? join(repositoryRoot, ".output", "live-provider");

const CLEANUP_TIMEOUT_MS = 5_000;
const TRANSLATION_TIMEOUT_MS = 120_000;

// Anchors whose box must not move when the text around them changes language.
const MEASURED_TARGETS = [
  { name: "hero", selector: "[data-calibration='hero']" },
  { name: "card", selector: "[data-calibration='card']" },
  { name: "table-panel", selector: "[data-calibration='table-panel']" },
  { name: "notice", selector: "[data-calibration='notice']" },
  { name: "long-form", selector: ".long-form" },
  { name: "footer", selector: ".site-footer" },
];

// Readable samples so a human can judge the translation, not just the geometry.
const SAMPLED_TEXT = [
  { name: "nav-first", selector: ".primary-nav a" },
  { name: "hero-heading", selector: ".hero-copy h1" },
  { name: "primary-button", selector: ".button-primary" },
  { name: "card-label", selector: "[data-calibration='card'] .card-label" },
  { name: "pill", selector: ".pill" },
  { name: "long-form-copy", selector: ".long-form-copy" },
];

function assert(condition, message) {
  if (!condition) throw new Error(`Live provider smoke assertion failed: ${message}`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function readEnvFile() {
  const path = join(repositoryRoot, ".env");
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/gu, "")];
    })
    .filter(([key]) => key));
}

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function waitFor(predicate, description, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ""}`);
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
  assert(port, "could not reserve a free port");
  return port;
}

function findChrome() {
  const candidates = [];
  if (process.env.LAYOUT_TRANSLATE_CHROME) candidates.push(process.env.LAYOUT_TRANSLATE_CHROME);
  const browserRoot = process.env.USERPROFILE
    ? join(process.env.USERPROFILE, ".agent-browser", "browsers")
    : undefined;
  if (browserRoot && existsSync(browserRoot)) {
    const stack = [browserRoot];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of readdirSyncSafe(current)) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/^chrome(\.exe)?$/iu.test(entry.name)) candidates.push(full);
      }
    }
  }
  candidates.push(...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "chrome.exe")));
  const chrome = candidates.find((candidate) => existsSync(candidate));
  assert(chrome, "Chrome for Testing was not found; run `agent-browser install` or set LAYOUT_TRANSLATE_CHROME");
  return chrome;
}

function readdirSyncSafe(directory) {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function startCorpusServer() {
  const allowed = new Set(["page.html", "styles.css"]);
  return createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname).replace(/^\/+/u, "")
      || "page.html";
    if (requested === "favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    if (!allowed.has(requested)) {
      response.writeHead(404).end();
      return;
    }
    const body = readFileSync(join(corpusRoot, requested));
    response.writeHead(200, {
      "content-type": requested.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  });
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

  call(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.webSocket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.webSocket.close();
  }
}

async function connectCdp(port) {
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
    const created = await cdp.call("Target.createTarget", { url: `chrome-extension://${extensionId}/popup.html` });
    const popup = await attachTarget(cdp, created.targetId);
    try {
      await waitFor(
        () => evaluate(cdp, popup, "Boolean(document.querySelector('main.popup-shell'))"),
        "extension popup",
      );
      return popup;
    } catch {
      await cdp.call("Target.closeTarget", { targetId: popup.targetId });
    }
  }
  throw new Error("Could not identify the built extension popup target");
}

async function captureScreenshot(cdp, target, path) {
  const result = await cdp.call("Page.captureScreenshot", { format: "png" }, target.sessionId);
  if (!result?.data) return null;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(result.data, "base64"));
  return path;
}

async function snapshotGeometry(cdp, page) {
  return evaluate(cdp, page, `(() => {
    const targets = ${JSON.stringify(MEASURED_TARGETS)};
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    return {
      targets: Object.fromEntries(targets.map((target) => [target.name, rect(target.selector)])),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      clippedElements: [...document.querySelectorAll("*")]
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => (typeof element.className === "string" && element.className) || element.tagName.toLowerCase())
        .slice(0, 12),
    };
  })()`);
}

async function sampleText(cdp, page) {
  return evaluate(cdp, page, `(() => {
    const samples = ${JSON.stringify(SAMPLED_TEXT)};
    return Object.fromEntries(samples.map((sample) => {
      const element = document.querySelector(sample.selector);
      return [sample.name, {
        text: element?.textContent?.trim().slice(0, 160) ?? null,
        title: element?.getAttribute("title") ?? null,
        ariaLabel: element?.getAttribute("aria-label") ?? null,
      }];
    }));
  })()`);
}

function compareGeometry(baseline, current) {
  const shifts = {};
  for (const target of MEASURED_TARGETS) {
    const before = baseline.targets[target.name];
    const after = current.targets[target.name];
    if (!before || !after) {
      shifts[target.name] = null;
      continue;
    }
    shifts[target.name] = {
      shift: Number(Math.hypot(after.left - before.left, after.top - before.top).toFixed(2)),
      widthDelta: Number((after.width - before.width).toFixed(2)),
      heightDelta: Number((after.height - before.height).toFixed(2)),
    };
  }
  return shifts;
}

const japanesePattern = "[\\u3040-\\u30ff\\u3400-\\u9fff]";

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn(taskkillCommand(), ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // The process may already have exited.
  }
  const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
}

async function main() {
  const env = { ...readEnvFile(), ...process.env };
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = parseArg("model", env.LAYOUT_TRANSLATE_PROVIDER_MODEL?.trim());
  assert(apiKey, "OPENAI_API_KEY must be present in .env or the environment");
  assert(model, "a provider model must be supplied with --model=<id> or LAYOUT_TRANSLATE_PROVIDER_MODEL");
  assert(existsSync(extensionRoot), "built extension is missing; run `npm run build` first");

  const report = {
    schema: "layout-translate/live-provider-smoke/v1",
    startedAt: new Date().toISOString(),
    provider: "openai",
    model,
    fixture: "fixtures/real-corpus/page.html",
    languages: {},
    restore: null,
    diagnostics: { pageErrors: 0, consoleErrors: 0, backendErrors: [] },
    cleanup: {},
    result: "failed",
  };

  const chromePath = findChrome();
  const profilePath = mkdtempSync(join(tmpdir(), "layout-translate-live-"));
  const server = startCorpusServer();
  let browser;
  let backend;
  let cdp;

  try {
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const fixturePort = server.address().port;
    const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;

    const backendPort = await findFreePort();
    const backendToken = "live-smoke-token";
    backend = spawn(
      process.execPath,
      [join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"), join(repositoryRoot, "backend", "src", "mock-server.ts")],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          LAYOUT_TRANSLATE_PROVIDER: "openai",
          OPENAI_API_KEY: apiKey,
          LAYOUT_TRANSLATE_PROVIDER_MODEL: model,
          LAYOUT_TRANSLATE_PROVIDER_TIMEOUT_MS: "90000",
          LAYOUT_TRANSLATE_MOCK_PORT: String(backendPort),
          LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN: backendToken,
          LAYOUT_TRANSLATE_ALLOWED_ORIGINS: fixtureOrigin,
          LAYOUT_TRANSLATE_ALLOW_EXTENSION_CLIENTS: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    backend.stdout.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/u).filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          if (event.event === "backend_started") report.backendStartup = event;
          if (event.event === "translation_response" && event.status >= 400) {
            report.diagnostics.backendErrors.push(event.status);
          }
        } catch {
          // Non-JSON startup lines are ignored.
        }
      }
    });
    backend.stderr.on("data", (chunk) => {
      report.diagnostics.backendErrors.push(String(chunk).split(/\r?\n/u)[0].slice(0, 120));
    });
    await waitFor(
      () => fetch(`${`http://127.0.0.1:${backendPort}`}/v1/translate`, { method: "OPTIONS" }).then(() => true).catch(() => false),
      "backend",
    );
    assert(report.backendStartup?.provider === "openai", "backend did not start in provider mode");

    const cdpPort = await findFreePort();
    browser = spawn(chromePath, [
      `--remote-debugging-port=${cdpPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${profilePath}`,
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
    ], { stdio: "ignore", windowsHide: true });
    cdp = await connectCdp(cdpPort);

    const created = await cdp.call("Target.createTarget", { url: `${fixtureOrigin}/page.html` });
    const page = await attachTarget(cdp, created.targetId);
    cdp.on("Runtime.exceptionThrown", (event) => {
      if (event.sessionId === page.sessionId) report.diagnostics.pageErrors += 1;
    });
    cdp.on("Runtime.consoleAPICalled", (event) => {
      if (event.sessionId === page.sessionId && ["error", "assert"].includes(event.params?.type)) {
        report.diagnostics.consoleErrors += 1;
      }
    });
    await cdp.call("Runtime.enable", {}, page.sessionId);
    await cdp.call("Page.enable", {}, page.sessionId);
    await waitFor(() => evaluate(cdp, page, "Boolean(document.querySelector('.primary-nav a'))"), "fixture content");
    await evaluate(cdp, page, "document.fonts?.ready");

    const popup = await findExtensionPopup(cdp);
    await evaluate(
      cdp,
      popup,
      `chrome.storage.local.set({"layout-translate:backend": { url: "http://127.0.0.1:${backendPort}", token: "${backendToken}", timeoutMs: 90000 }})`,
    );

    const baseline = await snapshotGeometry(cdp, page);
    report.baseline = { pageOverflow: baseline.pageOverflow, clippedElements: baseline.clippedElements };
    report.baselineText = await sampleText(cdp, page);

    await cdp.call("Target.activateTarget", { targetId: page.targetId });
    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");

    const readNav = () => evaluate(cdp, page, "document.querySelector('.primary-nav a')?.textContent?.trim() ?? null");

    for (const language of ["en", "vi"]) {
      // Comparing against the previous rendering matters: after English the page
      // already contains no Japanese, so an absence check alone would report the
      // Vietnamese pass as instantly complete.
      const previousNav = await readNav();
      const startedAt = Date.now();
      if (language === "vi") {
        await evaluate(cdp, popup, "[...document.querySelectorAll('.language-switch button')].find((b) => b.textContent.trim() === 'VI').click()");
      }
      await waitFor(
        () => evaluate(cdp, page, `(() => {
          const text = document.querySelector('.primary-nav a')?.textContent?.trim() ?? "";
          return text.length > 0 && text !== ${JSON.stringify(previousNav)} && !/${japanesePattern}/u.test(text);
        })()`),
        `${language} translation`,
        TRANSLATION_TIMEOUT_MS,
      );
      // Let the remaining batches settle before measuring the whole page.
      await waitFor(
        () => evaluate(cdp, page, `(() => {
          const remaining = [...document.querySelectorAll('.primary-nav a, .hero-copy h1, .button, .card-label, .pill, .long-form-copy')]
            .filter((element) => /${japanesePattern}/u.test(element.textContent ?? ""));
          return remaining.length === 0;
        })()`),
        `${language} full-page translation`,
        TRANSLATION_TIMEOUT_MS,
      );
      await waitFor(
        () => evaluate(cdp, popup, "(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' }))?.state?.status === 'rendered')()"),
        `${language} rendered state`,
        TRANSLATION_TIMEOUT_MS,
      );
      const elapsedMs = Date.now() - startedAt;
      const geometry = await snapshotGeometry(cdp, page);
      report.languages[language] = {
        elapsedMs,
        shifts: compareGeometry(baseline, geometry),
        pageOverflow: geometry.pageOverflow,
        clippedElements: geometry.clippedElements,
        samples: await sampleText(cdp, page),
        screenshot: await captureScreenshot(cdp, page, join(artifactDir, `live-${language}.png`)),
        translatedAnchors: await evaluate(cdp, popup, "(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' }))?.state?.translatedAnchors ?? null)()"),
        status: await evaluate(cdp, popup, "(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' }))?.state?.status ?? null)()"),
        lastError: await evaluate(cdp, popup, "(async () => (await chrome.runtime.sendMessage({ type: 'GET_STATE' }))?.state?.lastError ?? null)()"),
      };
    }

    await evaluate(cdp, popup, "document.querySelector('.restore-button').click()");
    await waitFor(
      () => evaluate(cdp, page, `/${japanesePattern}/u.test(document.querySelector('.primary-nav a')?.textContent ?? "")`),
      "restore to Japanese",
    );
    const restored = await snapshotGeometry(cdp, page);
    report.restore = {
      japaneseRestored: true,
      shifts: compareGeometry(baseline, restored),
      samples: await sampleText(cdp, page),
    };

    report.result = "passed";
  } finally {
    if (cdp) cdp.close();
    await stopProcess(browser);
    await stopProcess(backend);
    await new Promise((resolvePromise) => server.close(resolvePromise));
    try {
      rmSync(profilePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      report.cleanup.profileRemoved = !existsSync(profilePath);
    } catch {
      report.cleanup.profileRemoved = false;
    }
    report.finishedAt = new Date().toISOString();
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    result: report.result,
    model: report.model,
    en: { ms: report.languages.en?.elapsedMs, anchors: report.languages.en?.translatedAnchors },
    vi: { ms: report.languages.vi?.elapsedMs, anchors: report.languages.vi?.translatedAnchors },
    reportPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
