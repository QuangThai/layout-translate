import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { createServer as createTcpServer } from "node:net";

const repositoryRoot = resolve(import.meta.dirname, "..");
const extensionRoot = join(repositoryRoot, ".output", "chrome-mv3");
const fixturePath = "/fixtures/representative.html";

function assert(condition, message) {
  if (!condition) throw new Error(`E2E assertion failed: ${message}`);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
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

function findChromeForTesting() {
  const candidates = [];
  if (process.env.LAYOUT_TRANSLATE_CHROME) candidates.push(process.env.LAYOUT_TRANSLATE_CHROME);

  const browserRoot = process.env.USERPROFILE
    ? join(process.env.USERPROFILE, ".agent-browser", "browsers")
    : undefined;
  if (browserRoot && existsSync(browserRoot)) {
    for (const version of readdirSync(browserRoot).sort().reverse()) {
      candidates.push(join(browserRoot, version, "chrome.exe"));
    }
  }

  const pathCandidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, "chrome.exe"));
  candidates.push(...pathCandidates);

  const chrome = candidates.find((candidate) => existsSync(candidate));
  assert(
    chrome,
    "Chrome for Testing was not found; run `agent-browser install` or set LAYOUT_TRANSLATE_CHROME",
  );
  return chrome;
}

function startFixtureServer() {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
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
    webSocket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
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
  const chromePath = findChromeForTesting();
  const cdpPort = await findFreePort();
  const profilePath = mkdtempSync(join(tmpdir(), "layout-translate-e2e-"));
  const server = startFixtureServer();
  let browser;
  let cdp;
  let fixture;
  let popup;

  try {
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const serverAddress = server.address();
    const fixturePort = typeof serverAddress === "object" && serverAddress ? serverAddress.port : undefined;
    assert(fixturePort, "fixture server did not expose a port");

    browser = spawn(
      chromePath,
      [
        `--remote-debugging-port=${cdpPort}`,
        "--remote-allow-origins=*",
        `--user-data-dir=${profilePath}`,
        `--disable-extensions-except=${extensionRoot}`,
        `--load-extension=${extensionRoot}`,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1280,900",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    cdp = await connectCdp(cdpPort);

    const fixtureTarget = await cdp.call("Target.createTarget", {
      url: `http://127.0.0.1:${fixturePort}${fixturePath}`,
    });
    fixture = await attachTarget(cdp, fixtureTarget.targetId);
    await waitFor(
      () => evaluate(cdp, fixture, "Boolean(document.querySelector('nav a'))"),
      "fixture content",
    );
    popup = await findExtensionPopup(cdp);

    await evaluate(cdp, popup, "document.querySelector('button.toggle').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === 'Company'"),
      "English translation",
    );
    const english = await evaluate(
      cdp,
      fixture,
      `(() => ({
        navWidth: document.querySelector('nav')?.getBoundingClientRect().width,
        firstAnchor: document.querySelector('nav a')?.getBoundingClientRect().x,
        nav: [...document.querySelectorAll('nav a')].map((element) => element.textContent),
        tooltips: [...document.querySelectorAll('[title]')].map((element) => element.title),
      }))()`,
    );
    assert(english.nav.join("|") === "Company|Contact us|Terms", "English navigation rendered");
    assert(english.navWidth > 0, "English navigation geometry was measured");
    assert(english.tooltips.length > 0, "constrained content exposes full-text tooltips");

    await evaluate(cdp, popup, "document.querySelector('.language-switch button:nth-child(2)').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('nav a')?.textContent === 'Thông tin công ty'"),
      "Vietnamese translation",
    );
    const vietnamese = await evaluate(
      cdp,
      fixture,
      "({ navWidth: document.querySelector('nav')?.getBoundingClientRect().width, nav: [...document.querySelectorAll('nav a')].map((element) => element.textContent) })",
    );
    assert(vietnamese.nav.join("|") === "Thông tin công ty|Liên hệ với chúng tôi|Điều khoản", "Vietnamese navigation rendered");
    assert(vietnamese.navWidth === english.navWidth, "hard-preserve navigation width stayed stable");

    await evaluate(cdp, fixture, "document.querySelector('#route-button').click()");
    await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('#dynamic-copy')?.textContent === 'Thông báo mới'"),
      "translated SPA content",
    );

    await evaluate(cdp, popup, "document.querySelector('button.restore-button').click()");
    const restored = await waitFor(
      () => evaluate(cdp, fixture, "document.querySelector('#dynamic-copy')?.textContent === '新しい通知'"),
      "restored SPA source",
    );
    const restoredState = await evaluate(
      cdp,
      fixture,
      `({ nav: [...document.querySelectorAll('nav a')].map((element) => element.textContent), titles: [...document.querySelectorAll('[title]')].length })`,
    );
    assert(restored === true, "restore completed");
    assert(restoredState.nav.join("|") === "会社情報|お問い合わせはこちら|利用規約", "original navigation restored");
    assert(restoredState.titles === 0, "extension presentation styles and titles restored");

    console.log(JSON.stringify({
      result: "passed",
      fixture: `http://127.0.0.1:${fixturePort}${fixturePath}`,
      english,
      vietnamese,
      dynamicSpa: "translated and restored",
      originalRestored: true,
    }, null, 2));
  } finally {
    if (popup) await cdp?.call("Target.closeTarget", { targetId: popup.targetId }).catch(() => undefined);
    if (fixture) await cdp?.call("Target.closeTarget", { targetId: fixture.targetId }).catch(() => undefined);
    await cdp?.close().catch(() => undefined);
    if (browser && !browser.killed) browser.kill();
    await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    await sleep(250);
    try {
      rmSync(profilePath, { recursive: true, force: true });
    } catch (error) {
      // Chrome for Testing can hold a profile lock briefly after its process exits.
      // The profile is task-owned; leaving it for the OS is safer than failing a
      // passed browser assertion because cleanup raced the browser shutdown.
      console.warn(`Warning: could not remove temporary browser profile ${profilePath}: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
