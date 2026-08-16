// Drives the built extension against a real website with a real provider and
// reports what happened to the page: how much was translated, whether anchors
// moved, whether anything overflowed or clipped, and whether restore returned
// the original.
//
// Developer verification per docs/decisions/0005-live-site-developer-verification.md.
// It reports measurements; it enforces no tolerance and is not a gate.
//
// Automation note: Chrome's per-site permission prompt cannot be driven, so this
// runner copies the build and declares the target origin in the copy's
// host_permissions. That is the same grant the popup asks a person for; the
// shipped build still holds only the fixture hosts.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { taskkillCommand } from "./process-tree.mjs";
import { chromium } from "playwright-core";

const repositoryRoot = resolve(import.meta.dirname, "..");
const buildRoot = join(repositoryRoot, ".output", "chrome-mv3");
const runtimeExtensionRoot = join(repositoryRoot, ".output", "live-site-extension");
const reportPath = process.env.LAYOUT_TRANSLATE_LIVE_SITE_REPORT
  ?? join(repositoryRoot, ".output", "live-site-report.json");
const artifactDir = process.env.LAYOUT_TRANSLATE_LIVE_SITE_ARTIFACTS
  ?? join(repositoryRoot, ".output", "live-site");

const TRANSLATION_TIMEOUT_MS = 240_000;
const SETTLE_MS = 1_500;
const JAPANESE = "[\\u3040-\\u30ff\\u3400-\\u9fff]";

function assert(condition, message) {
  if (!condition) throw new Error(`Live site E2E assertion failed: ${message}`);
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

function arg(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function findFreePort() {
  const server = createTcpServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = server.address().port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
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
      let entries = [];
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (/^chrome(\.exe)?$/iu.test(entry.name)) candidates.push(full);
      }
    }
  }
  candidates.push(...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "chrome.exe")));
  const chrome = candidates.find((candidate) => existsSync(candidate));
  assert(chrome, "Chrome for Testing was not found; set LAYOUT_TRANSLATE_CHROME");
  return chrome;
}

/** Copies the build and declares the target origin, replacing the interactive grant. */
function prepareExtension(origin) {
  rmSync(runtimeExtensionRoot, { recursive: true, force: true });
  cpSync(buildRoot, runtimeExtensionRoot, { recursive: true });
  const manifestPath = join(runtimeExtensionRoot, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pattern = `${origin}/*`;
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), pattern])];
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  return { pattern, hostPermissions: manifest.host_permissions };
}

const MEASURE = `(() => {
  const japanese = /${JAPANESE}/u;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let japaneseNodes = 0;
  let textNodes = 0;
  while (node) {
    const text = node.data.trim();
    if (text) {
      textNodes += 1;
      if (japanese.test(text)) japaneseNodes += 1;
    }
    node = walker.nextNode();
  }
  const describe = (element) => {
    const box = element.getBoundingClientRect();
    return {
      left: Math.round(box.left * 100) / 100,
      top: Math.round((box.top + window.scrollY) * 100) / 100,
      width: Math.round(box.width * 100) / 100,
      height: Math.round(box.height * 100) / 100,
    };
  };
  const anchors = {};
  const structural = [...document.querySelectorAll("header, nav, main, footer, section")].slice(0, 10);
  structural.forEach((element, index) => {
    anchors[element.tagName.toLowerCase() + "-" + index] = describe(element);
  });
  const clipped = [...document.querySelectorAll("body *")]
    .filter((element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (style.overflow === "auto" || style.overflow === "scroll" || style.overflowX === "auto" || style.overflowX === "scroll") return false;
      return element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0;
    })
    .slice(0, 40)
    .map((element) => (typeof element.className === "string" && element.className.trim())
      ? element.className.trim().slice(0, 40)
      : element.tagName.toLowerCase());
  const samples = [...document.querySelectorAll("header a, nav a, h1, h2, button, footer a")]
    .slice(0, 8)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      text: (element.textContent ?? "").trim().slice(0, 90),
      title: element.getAttribute("title"),
    }));
  // Strings that live in attributes are invisible to a text-node walk, so they
  // are counted separately or a form full of Japanese placeholders would report
  // as fully translated.
  let japaneseAttributes = 0;
  const japaneseAttributeSamples = [];
  for (const element of document.querySelectorAll("[placeholder],[alt],[title],[aria-label]")) {
    for (const name of ["placeholder", "alt", "title", "aria-label"]) {
      const value = element.getAttribute(name);
      if (value && japanese.test(value)) {
        japaneseAttributes += 1;
        if (japaneseAttributeSamples.length < 6) japaneseAttributeSamples.push(name + ":" + value.slice(0, 24));
      }
    }
  }
  return {
    japaneseNodes,
    japaneseAttributes,
    japaneseAttributeSamples,
    textNodes,
    anchors,
    clipped,
    clippedCount: clipped.length,
    samples,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    scrollHeight: document.documentElement.scrollHeight,
  };
})()`;

function compareAnchors(before, after) {
  const shifts = {};
  for (const [name, box] of Object.entries(before.anchors)) {
    const next = after.anchors[name];
    if (!next) {
      shifts[name] = null;
      continue;
    }
    shifts[name] = {
      shift: Math.round(Math.hypot(next.left - box.left, next.top - box.top) * 100) / 100,
      widthDelta: Math.round((next.width - box.width) * 100) / 100,
      heightDelta: Math.round((next.height - box.height) * 100) / 100,
    };
  }
  return shifts;
}

const SAMPLE_TEXTS = `[...document.querySelectorAll("header a, nav a, h1, h2, button, footer a")]
  .slice(0, 8)
  .map((element) => (element.textContent ?? "").trim())`;

async function sampleTexts(page) {
  return page.evaluate(SAMPLE_TEXTS).catch(() => []);
}

function changedCount(before, after) {
  return before.filter((text, index) => text && after[index] && text !== after[index]).length;
}

async function waitForRendered(popup, page, baselineJapanese, previousTexts, label) {
  const deadline = Date.now() + TRANSLATION_TIMEOUT_MS;
  let last = {};
  while (Date.now() < deadline) {
    const state = await popup.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      return {
        status: response?.state?.status ?? null,
        translatedAnchors: response?.state?.translatedAnchors ?? 0,
        lastError: response?.state?.lastError ?? null,
      };
    }).catch(() => ({ status: null, translatedAnchors: 0, lastError: null }));
    const japaneseNodes = await page.evaluate(`(() => {
      const japanese = /${JAPANESE}/u;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let count = 0;
      while (node) {
        if (node.data.trim() && japanese.test(node.data)) count += 1;
        node = walker.nextNode();
      }
      return count;
    })()`).catch(() => baselineJapanese);
    const texts = await sampleTexts(page);
    const changed = changedCount(previousTexts, texts);
    const comparable = previousTexts.filter((text, index) => text && texts[index]).length;
    last = { ...state, japaneseNodes, changed, comparable };
    if (state.lastError) throw new Error(`${label} failed: ${state.lastError}`);
    // Absence of Japanese is not enough: after English the page already has
    // none, so a Vietnamese pass would look instantly complete. Require the
    // rendering to have actually changed from the previous one.
    const rerendered = comparable === 0 || changed >= Math.max(1, Math.floor(comparable / 2));
    // A live SPA keeps mutating, so the engine may re-enter translating; accept
    // the pass once most Japanese is gone and the engine has settled.
    if (state.status === "rendered" && rerendered
      && japaneseNodes <= Math.max(2, Math.floor(baselineJapanese * 0.15))) {
      return last;
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(last)}`);
}

async function main() {
  const env = { ...readEnvFile(), ...process.env };
  const model = arg("model", env.LAYOUT_TRANSLATE_PROVIDER_MODEL?.trim());
  const target = arg("site", (env.LAYOUT_TRANSLATE_SITES ?? "").split(",")[0]?.trim());
  const apiKey = env.OPENAI_API_KEY?.trim();
  assert(apiKey, "OPENAI_API_KEY must be set in .env or the environment");
  assert(model, "a model is required: set LAYOUT_TRANSLATE_PROVIDER_MODEL in .env or pass --model=");
  assert(target, "a target site is required: set LAYOUT_TRANSLATE_SITES in .env or pass --site=");
  assert(existsSync(buildRoot), "built extension is missing; run `npm run build` first");

  const targetUrl = new URL(target.includes("://") ? target : `https://${target}`);
  const origin = targetUrl.origin;
  const language = arg("language", "both");
  assert(["en", "vi", "both"].includes(language), `unsupported --language=${language}`);
  const languages = language === "both" ? ["en", "vi"] : [language];

  const report = {
    schema: "layout-translate/live-site-e2e/v1",
    startedAt: new Date().toISOString(),
    provider: "openai",
    model,
    site: origin,
    url: targetUrl.toString(),
    grantedByAutomation: null,
    baseline: null,
    languages: {},
    restore: null,
    diagnostics: { pageErrors: [], consoleErrors: 0, backendErrors: [] },
    cleanup: {},
    result: "failed",
  };

  // Every provider call costs money, so churn is measured rather than assumed:
  // a page that re-translates the same text after a scroll or an animation is
  // paying twice for it.
  const provider = { requests: 0, items: 0 };
  const meterFrom = () => ({ requests: provider.requests, items: provider.items });
  const meterSince = (mark) => ({
    requests: provider.requests - mark.requests,
    items: provider.items - mark.items,
  });

  const chromePath = findChrome();
  const grant = prepareExtension(origin);
  report.grantedByAutomation = grant.pattern;
  const profileDir = mkdtempSync(join(tmpdir(), "layout-translate-live-site-"));
  const backendPort = await findFreePort();
  const backendToken = "live-site-token";
  let backend;
  let context;

  try {
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
          LAYOUT_TRANSLATE_ALLOWED_ORIGINS: origin,
          LAYOUT_TRANSLATE_ALLOW_EXTENSION_CLIENTS: "true",
          LAYOUT_TRANSLATE_RATE_LIMIT: "600",
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
          if (event.event === "translation_response" && event.status === 200) {
            provider.requests += 1;
            provider.items += event.itemCount ?? 0;
          }
        } catch {
          // Startup banner is not JSON.
        }
      }
    });
    backend.stderr.on("data", (chunk) => {
      report.diagnostics.backendErrors.push(String(chunk).split(/\r?\n/u)[0].slice(0, 160));
    });

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !report.backendStartup) await sleep(250);
    assert(report.backendStartup?.provider === "openai", "backend did not start in real provider mode");

    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: chromePath,
      headless: true,
      viewport: { width: 1440, height: 900 },
      // Headless Chrome advertises itself as HeadlessChrome, and some sites
      // answer that with a block page instead of their content. This is the
      // same browser either way; only the label changes. A site that still
      // refuses is left alone rather than worked around further.
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      args: [
        `--disable-extensions-except=${runtimeExtensionRoot}`,
        `--load-extension=${runtimeExtensionRoot}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    report.extensionId = extensionId;

    await worker.evaluate(async (config) => {
      await chrome.storage.local.set({ "layout-translate:backend": config });
    }, { url: `http://127.0.0.1:${backendPort}`, token: backendToken, timeoutMs: 90_000 });

    const page = await context.newPage();
    page.on("pageerror", (error) => {
      if (report.diagnostics.pageErrors.length < 10) {
        report.diagnostics.pageErrors.push(String(error.message).slice(0, 120));
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error") report.diagnostics.consoleErrors += 1;
    });

    await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
    await page.evaluate("document.fonts?.ready").catch(() => undefined);
    await sleep(SETTLE_MS);

    const baseline = await page.evaluate(MEASURE);
    report.baseline = baseline;
    if (baseline.japaneseNodes === 0) {
      // Say what the browser actually received. A site that serves a different
      // page to this browser looks identical to a site with no Japanese on it.
      mkdirSync(artifactDir, { recursive: true });
      const shot = join(artifactDir, "live-empty.png");
      await page.screenshot({ path: shot }).catch(() => undefined);
      report.emptyPageDiagnostics = {
        ...await page.evaluate(() => ({
          url: location.href,
          title: document.title,
          bodyChildren: document.body?.children.length ?? 0,
          bodyTextLength: (document.body?.innerText ?? "").trim().length,
          firstText: (document.body?.innerText ?? "").trim().slice(0, 200),
        })),
        screenshot: shot,
      };
      throw new Error(`the target page returned no Japanese text: ${JSON.stringify(report.emptyPageDiagnostics)}`);
    }

    // The real flow injects on grant instead of reloading, so exercise that path.
    await worker.evaluate(async (file) => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) throw new Error("no active tab to inject into");
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
    }, "/content-scripts/translate.js");

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector("main.popup-shell");
    await page.bringToFront();

    await popup.evaluate(() => document.querySelector("button.toggle").click());

    for (const targetLanguage of languages) {
      const previousTexts = await sampleTexts(page);
      const languageMark = meterFrom();
      const startedAt = Date.now();
      // Clicking the language already selected is a no-op in the popup, so the
      // first pass needs no special case.
      await popup.evaluate((code) => {
        const button = [...document.querySelectorAll(".language-switch button")]
          .find((item) => item.textContent.trim().toUpperCase() === code);
        button?.click();
      }, targetLanguage.toUpperCase());
      const settled = await waitForRendered(
        popup,
        page,
        baseline.japaneseNodes,
        previousTexts,
        `${targetLanguage} translation`,
      );
      await sleep(SETTLE_MS);
      const measured = await page.evaluate(MEASURE);
      mkdirSync(artifactDir, { recursive: true });
      const screenshot = join(artifactDir, `live-${targetLanguage}.png`);
      await page.screenshot({ path: screenshot }).catch(() => undefined);

      report.languages[targetLanguage] = {
        elapsedMs: Date.now() - startedAt,
        provider: meterSince(languageMark),
        translatedAnchors: settled.translatedAnchors,
        status: settled.status,
        japaneseNodesRemaining: measured.japaneseNodes,
        japaneseNodesBefore: baseline.japaneseNodes,
        japaneseAttributesBefore: baseline.japaneseAttributes,
        japaneseAttributesRemaining: measured.japaneseAttributes,
        japaneseAttributeSamples: measured.japaneseAttributeSamples,
        anchorShifts: compareAnchors(baseline, measured),
        pageOverflowBefore: baseline.pageOverflow,
        pageOverflow: measured.pageOverflow,
        clippedBefore: baseline.clippedCount,
        clippedAfter: measured.clippedCount,
        newlyClipped: measured.clipped.filter((name) => !baseline.clipped.includes(name)).slice(0, 12),
        scrollHeightDelta: measured.scrollHeight - baseline.scrollHeight,
        samples: measured.samples,
        screenshot,
      };
    }

    // A real page keeps loading as the reader scrolls, and keeps animating once
    // they stop. Both are ordinary reading behaviour, and both are invisible to
    // a fixture that fits on one screen.
    const beforeScroll = await page.evaluate(MEASURE);
    const scrollMark = meterFrom();
    const scrollStartedAt = Date.now();
    await page.evaluate(async (steps) => {
      for (let step = 1; step <= steps; step += 1) {
        const total = document.documentElement.scrollHeight;
        window.scrollTo({ top: (total / steps) * step, behavior: "instant" });
        await new Promise((settle) => setTimeout(settle, 700));
      }
    }, 12);
    await sleep(SETTLE_MS);
    // The page is already translated here, so the question is whether scrolling
    // introduced untranslated text, not whether Japanese fell by a percentage.
    const scrollDeadline = Date.now() + 60_000;
    let settledAfterScroll = { status: "unsettled" };
    while (Date.now() < scrollDeadline) {
      const state = await popup.evaluate(async () => {
        const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
        return { status: response?.state?.status ?? null, lastError: response?.state?.lastError ?? null };
      }).catch(() => ({ status: null, lastError: null }));
      const current = await page.evaluate(MEASURE);
      if (state.status === "rendered" && current.japaneseNodes <= beforeScroll.japaneseNodes) {
        settledAfterScroll = state;
        break;
      }
      await sleep(1_000);
    }
    const afterScroll = await page.evaluate(MEASURE);
    mkdirSync(artifactDir, { recursive: true });
    const scrollShot = join(artifactDir, "live-scrolled.png");
    await page.screenshot({ path: scrollShot }).catch(() => undefined);
    report.scroll = {
      elapsedMs: Date.now() - scrollStartedAt,
      status: settledAfterScroll.status ?? null,
      textNodesBefore: beforeScroll.textNodes,
      textNodesAfter: afterScroll.textNodes,
      textNodesAppeared: afterScroll.textNodes - beforeScroll.textNodes,
      japaneseBefore: beforeScroll.japaneseNodes,
      japaneseAfter: afterScroll.japaneseNodes,
      providerSince: meterSince(scrollMark),
      pageOverflow: afterScroll.pageOverflow,
      clippedAfter: afterScroll.clippedCount,
      screenshot: scrollShot,
    };

    // Nothing is touched here. Any provider call during this window is the page
    // animating, not the reader asking for anything.
    const idleMark = meterFrom();
    const idleBefore = await page.evaluate(MEASURE);
    await sleep(15_000);
    const idleAfter = await page.evaluate(MEASURE);
    report.idle = {
      windowMs: 15_000,
      providerSince: meterSince(idleMark),
      japaneseBefore: idleBefore.japaneseNodes,
      japaneseAfter: idleAfter.japaneseNodes,
      textNodesDelta: idleAfter.textNodes - idleBefore.textNodes,
    };

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(SETTLE_MS);
    await popup.evaluate(() => document.querySelector(".restore-button").click());
    const restoreDeadline = Date.now() + 60_000;
    let restored = null;
    while (Date.now() < restoreDeadline) {
      const measured = await page.evaluate(MEASURE);
      if (measured.japaneseNodes >= Math.floor(baseline.japaneseNodes * 0.9)) {
        restored = measured;
        break;
      }
      await sleep(1_000);
    }
    assert(restored, "restore did not return the Japanese source");
    report.restore = {
      japaneseNodes: restored.japaneseNodes,
      japaneseNodesBefore: baseline.japaneseNodes,
      anchorShifts: compareAnchors(baseline, restored),
      pageOverflow: restored.pageOverflow,
      scrollHeightDelta: restored.scrollHeight - baseline.scrollHeight,
    };

    report.result = "passed";
  } finally {
    await context?.close().catch(() => undefined);
    if (backend && backend.exitCode === null) {
      try {
        if (process.platform === "win32") {
          spawn(taskkillCommand(), ["/pid", String(backend.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
        } else {
          backend.kill("SIGTERM");
        }
      } catch {
        // Already gone.
      }
      const stopBy = Date.now() + 5_000;
      while (backend.exitCode === null && Date.now() < stopBy) await sleep(100);
    }
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      report.cleanup.profileRemoved = !existsSync(profileDir);
    } catch {
      report.cleanup.profileRemoved = false;
    }
    rmSync(runtimeExtensionRoot, { recursive: true, force: true });
    report.cleanup.runtimeExtensionRemoved = !existsSync(runtimeExtensionRoot);
    report.cleanup.backendStopped = backend ? backend.exitCode !== null : null;
    report.finishedAt = new Date().toISOString();
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    result: report.result,
    site: report.site,
    model: report.model,
    languages: Object.fromEntries(Object.entries(report.languages).map(([code, data]) => [code, {
      ms: data.elapsedMs,
      anchors: data.translatedAnchors,
      japaneseLeft: `${data.japaneseNodesRemaining}/${data.japaneseNodesBefore}`,
      japaneseAttributesLeft: `${data.japaneseAttributesRemaining}/${data.japaneseAttributesBefore}`,
      pageOverflow: data.pageOverflow,
      newlyClipped: data.newlyClipped.length,
      providerItems: data.provider.items,
    }])),
    scroll: report.scroll && {
      appearedTextNodes: report.scroll.textNodesAppeared,
      japaneseAfter: report.scroll.japaneseAfter,
      providerItems: report.scroll.providerSince.items,
      status: report.scroll.status,
    },
    idleChurn: report.idle && {
      providerRequests: report.idle.providerSince.requests,
      providerItems: report.idle.providerSince.items,
    },
    restored: report.restore?.japaneseNodes ?? null,
    pageErrors: report.diagnostics.pageErrors.length,
    reportPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
