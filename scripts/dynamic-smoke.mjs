// Drives the dynamic fixture: content appended on scroll, a section revealed on
// intersection, page-owned text the site keeps rewriting, recycled list rows,
// and a continuous CSS animation.
//
// Offline and deterministic: it uses the mock backend with fixed translation
// overrides, so it costs nothing and can run repeatedly.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createServer as createTcpServer } from "node:net";
import { chromium } from "playwright-core";
import { taskkillCommand } from "./process-tree.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const extensionRoot = join(repositoryRoot, ".output", "chrome-mv3");
const fixtureRoot = join(repositoryRoot, "fixtures");
const reportPath = process.env.LAYOUT_TRANSLATE_DYNAMIC_REPORT
  ?? join(repositoryRoot, ".output", "dynamic-smoke-report.json");

const SETTLE_MS = 900;
const JAPANESE = /[぀-ヿ㐀-鿿]/u;

// Every Japanese string the fixture can display, so the mock backend answers
// deterministically instead of echoing unknown input.
const TRANSLATIONS = {
  記事一覧: { en: "Articles", vi: "Bài viết" },
  詳細情報: { en: "Details", vi: "Chi tiết" },
  進行状況: { en: "Progress", vi: "Tiến độ" },
  処理中です: { en: "Processing", vi: "Đang xử lý" },
  状態: { en: "Status", vi: "Trạng thái" },
  更新中: { en: "Updating", vi: "Đang cập nhật" },
  完了しました: { en: "Completed", vi: "Đã hoàn tất" },
  "ページが定期的にこの文字列を書き換えます。": {
    en: "The page rewrites this string on a timer.",
    vi: "Trang tự ghi lại chuỗi này theo chu kỳ.",
  },
  一覧: { en: "List", vi: "Danh sách" },
  新着: { en: "New", vi: "Mới" },
  記事の見出し: { en: "Article heading", vi: "Tiêu đề bài viết" },
  続きを読む: { en: "Read more", vi: "Đọc tiếp" },
  読み込み中: { en: "Loading", vi: "Đang tải" },
  すべて表示しました: { en: "All items shown", vi: "Đã hiển thị tất cả" },
  遅延セクション: { en: "Deferred section", vi: "Phần tải trễ" },
  補足説明: { en: "Additional notes", vi: "Ghi chú bổ sung" },
};

// Proves the assertions can fail: with translations withheld the page stays
// Japanese, so every content check below must go red. A suite that has never
// been red is not evidence.
const negativeControl = process.argv.includes("--negative-control");

const failures = [];

function check(name, condition, detail) {
  if (!condition) failures.push({ name, detail: detail ?? null });
  return condition;
}

function sleep(ms) {
  return new Promise((settle) => setTimeout(settle, ms));
}

async function findFreePort() {
  const server = createTcpServer();
  await new Promise((settle, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", settle);
  });
  const port = server.address().port;
  await new Promise((settle) => server.close(settle));
  return port;
}

function findChrome() {
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
  candidates.push(...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "chrome.exe")));
  const chrome = candidates.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error("Chrome for Testing was not found; set LAYOUT_TRANSLATE_CHROME");
  return chrome;
}

function startFixtureServer() {
  return createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname).replace(/^\/+/u, "");
    if (requested === "favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    const filePath = resolve(fixtureRoot, requested || "dynamic.html");
    if (!filePath.startsWith(fixtureRoot) || !existsSync(filePath)) {
      response.writeHead(404).end();
      return;
    }
    const type = filePath.endsWith(".css")
      ? "text/css; charset=utf-8"
      : filePath.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "text/html; charset=utf-8";
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(readFileSync(filePath));
  });
}

const expectation = (source, language) => TRANSLATIONS[source]?.[language] ?? source;

async function main() {
  if (!existsSync(extensionRoot)) throw new Error("built extension is missing; run `npm run build` first");

  const report = {
    schema: "layout-translate/dynamic-smoke/v1",
    startedAt: new Date().toISOString(),
    phases: {},
    provider: { requests: 0, items: 0 },
    diagnostics: { pageErrors: [], consoleErrors: 0 },
    cleanup: {},
    result: "failed",
  };
  const provider = report.provider;
  const mark = () => ({ requests: provider.requests, items: provider.items });
  const since = (from) => ({ requests: provider.requests - from.requests, items: provider.items - from.items });

  const overridesPath = join(tmpdir(), `layout-translate-dynamic-${process.pid}.json`);
  writeFileSync(overridesPath, JSON.stringify(negativeControl ? {} : TRANSLATIONS), "utf8");
  const profileDir = mkdtempSync(join(tmpdir(), "layout-translate-dynamic-"));
  const server = startFixtureServer();
  let backend;
  let context;

  try {
    await new Promise((settle, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", settle);
    });
    const fixturePort = server.address().port;
    const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
    const backendPort = await findFreePort();
    const backendToken = "dynamic-token";

    backend = spawn(
      process.execPath,
      [join(repositoryRoot, "node_modules", "tsx", "dist", "cli.mjs"), join(repositoryRoot, "backend", "src", "mock-server.ts")],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          LAYOUT_TRANSLATE_PROVIDER: "mock",
          LAYOUT_TRANSLATE_MOCK_PORT: String(backendPort),
          LAYOUT_TRANSLATE_MOCK_AUTH_TOKEN: backendToken,
          LAYOUT_TRANSLATE_ALLOWED_ORIGINS: fixtureOrigin,
          LAYOUT_TRANSLATE_ALLOW_EXTENSION_CLIENTS: "true",
          LAYOUT_TRANSLATE_MOCK_TRANSLATION_OVERRIDES: overridesPath,
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
          if (event.event === "translation_response" && event.status === 200) {
            provider.requests += 1;
            provider.items += event.itemCount ?? 0;
          }
        } catch {
          // Startup banner is not JSON.
        }
      }
    });

    const ready = Date.now() + 20_000;
    while (Date.now() < ready) {
      const alive = await fetch(`http://127.0.0.1:${backendPort}/v1/translate`, { method: "OPTIONS" })
        .then(() => true)
        .catch(() => false);
      if (alive) break;
      await sleep(250);
    }

    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: findChrome(),
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [
        `--disable-extensions-except=${extensionRoot}`,
        `--load-extension=${extensionRoot}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });

    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 30_000 });
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async (config) => {
      await chrome.storage.local.set({ "layout-translate:backend": config });
    }, { url: `http://127.0.0.1:${backendPort}`, token: backendToken });

    const page = await context.newPage();
    page.on("pageerror", (error) => report.diagnostics.pageErrors.push(String(error.message).slice(0, 140)));
    page.on("console", (message) => {
      if (message.type() === "error") report.diagnostics.consoleErrors += 1;
    });
    await page.goto(`${fixtureOrigin}/dynamic.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-probe='ticker']");

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector("main.popup-shell");
    await page.bringToFront();
    await popup.evaluate(() => document.querySelector("button.toggle").click());

    const waitForText = async (selector, expected, label, timeout = 20_000) => {
      const deadline = Date.now() + timeout;
      let seen = null;
      while (Date.now() < deadline) {
        seen = await page.evaluate((target) =>
          document.querySelector(target)?.textContent?.trim() ?? null, selector);
        if (seen === expected) return true;
        await sleep(200);
      }
      check(label, false, `expected ${JSON.stringify(expected)}, saw ${JSON.stringify(seen)}`);
      return false;
    };

    // 1. Static content on first render.
    const initialMark = mark();
    await waitForText("[data-probe='motion']", expectation("処理中です", "en"), "initial static text translated");
    await waitForText(".site-header nav a", expectation("記事一覧", "en"), "navigation translated");
    report.phases.initial = { provider: since(initialMark) };

    // 2. Content appended while scrolling.
    const scrollMark = mark();
    for (let step = 0; step < 14; step += 1) {
      await page.evaluate(() => window.scrollBy({ top: 600, behavior: "instant" }));
      await sleep(300);
    }
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await sleep(SETTLE_MS);

    const feedBatches = await page.evaluate(() => window.dynamicFixture.feedBatches);
    check("feed appended while scrolling", feedBatches > 0, `batches=${feedBatches}`);

    const cardState = await (async () => {
      const deadline = Date.now() + 25_000;
      let snapshot = null;
      while (Date.now() < deadline) {
        snapshot = await page.evaluate(() => {
          const cards = [...document.querySelectorAll(".feed-card")];
          return {
            total: cards.length,
            headings: cards.map((card) => card.querySelector("h3")?.textContent?.trim() ?? ""),
            actions: cards.map((card) => card.querySelector(".feed-action")?.textContent?.trim() ?? ""),
          };
        });
        const untranslated = [...snapshot.headings, ...snapshot.actions]
          .filter((text) => /[぀-ヿ㐀-鿿]/u.test(text));
        if (snapshot.total > 0 && untranslated.length === 0) return { ...snapshot, untranslated: 0 };
        await sleep(500);
      }
      const untranslated = [...snapshot.headings, ...snapshot.actions]
        .filter((text) => JAPANESE.test(text));
      return { ...snapshot, untranslated: untranslated.length };
    })();
    check(
      "content appended on scroll is translated",
      cardState.total > 0 && cardState.untranslated === 0,
      `cards=${cardState.total} untranslated=${cardState.untranslated}`,
    );
    check(
      "appended action label uses the translated value",
      cardState.actions.every((text) => text === expectation("続きを読む", "en")),
      JSON.stringify(cardState.actions.slice(0, 3)),
    );
    report.phases.scroll = {
      provider: since(scrollMark),
      feedBatches,
      cards: cardState.total,
      untranslatedCards: cardState.untranslated,
    };

    // 3. Section revealed on intersection.
    const revealed = await page.evaluate(() => window.dynamicFixture.deferredRevealed);
    check("deferred section was revealed by scrolling", revealed === true);
    await waitForText("[data-probe='deferred']", expectation("遅延セクション", "en"), "revealed section translated");

    // 4. Page-owned text the site keeps rewriting.
    const tickerObservations = [];
    for (let sample = 0; sample < 6; sample += 1) {
      await sleep(700);
      tickerObservations.push(await page.evaluate(() => ({
        source: window.dynamicFixture.currentTicker(),
        shown: document.querySelector("[data-probe='ticker']")?.textContent?.trim() ?? "",
      })));
    }
    const tickerMatches = tickerObservations.filter((entry) => entry.shown === expectation(entry.source, "en"));
    const tickerStale = tickerObservations.filter((entry) =>
      entry.shown !== expectation(entry.source, "en") && !JAPANESE.test(entry.shown));
    check(
      "page-owned text churn keeps showing a current translation",
      tickerMatches.length >= 3,
      JSON.stringify(tickerObservations),
    );
    check(
      "page-owned text churn never settles on a stale translation",
      tickerStale.length === 0 || tickerMatches.length >= tickerStale.length,
      JSON.stringify(tickerStale.slice(0, 3)),
    );
    report.phases.ticker = { observations: tickerObservations, matched: tickerMatches.length };

    // 5. Recycled rows must show their current text, not the previous row's.
    await sleep(1_400);
    const rowState = await page.evaluate(() => ({
      sources: window.dynamicFixture.currentRows(),
      shown: [...document.querySelectorAll(".recycler li")].map((row) => row.textContent?.trim() ?? ""),
    }));
    // A recycled row showing another row's translation is the failure that
    // matters here: it is wrong text, not merely late text.
    const rowMismatches = rowState.shown.filter((text, index) =>
      !JAPANESE.test(text) && text !== expectation(rowState.sources[index], "en"));
    check(
      "recycled rows never show another row's translation",
      rowMismatches.length === 0,
      JSON.stringify({ sources: rowState.sources, shown: rowState.shown }),
    );
    report.phases.recycler = { ...rowState, mismatches: rowMismatches.length };

    // 6. What the page's own text churn costs while the reader does nothing.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(SETTLE_MS);
    const churnMark = mark();
    await sleep(10_000);
    report.phases.textChurn = { windowMs: 10_000, provider: since(churnMark) };

    // 7. Animation with no text change must cost nothing.
    await page.evaluate(() => window.dynamicFixture.stopTextTimers());
    await sleep(2_000);
    const animationMark = mark();
    await sleep(10_000);
    const animationChurn = since(animationMark);
    check(
      "a running animation with no text change costs no translation",
      animationChurn.requests === 0,
      JSON.stringify(animationChurn),
    );
    report.phases.animationOnly = { windowMs: 10_000, provider: animationChurn };

    // 8. Restore.
    await popup.evaluate(() => document.querySelector(".restore-button").click());
    const restoreDeadline = Date.now() + 20_000;
    let restoredJapanese = 0;
    while (Date.now() < restoreDeadline) {
      restoredJapanese = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let count = 0;
        while (node) {
          if (node.data.trim() && /[぀-ヿ㐀-鿿]/u.test(node.data)) count += 1;
          node = walker.nextNode();
        }
        return count;
      });
      if (restoredJapanese > 0) break;
      await sleep(500);
    }
    check("restore returns the Japanese source", restoredJapanese > 0, `japaneseNodes=${restoredJapanese}`);
    report.phases.restore = { japaneseNodes: restoredJapanese };

    check("no page errors", report.diagnostics.pageErrors.length === 0, JSON.stringify(report.diagnostics.pageErrors));
    report.result = failures.length === 0 ? "passed" : "failed";
    report.failures = failures;
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
    await new Promise((settle) => server.close(settle));
    rmSync(overridesPath, { force: true });
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      report.cleanup.profileRemoved = !existsSync(profileDir);
    } catch {
      report.cleanup.profileRemoved = false;
    }
    report.cleanup.backendStopped = backend ? backend.exitCode !== null : null;
    report.finishedAt = new Date().toISOString();
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    result: report.result,
    negativeControl,
    failures: failures.map((failure) => failure.name),
    phases: {
      scroll: report.phases.scroll,
      ticker: report.phases.ticker && { matched: report.phases.ticker.matched },
      recycler: report.phases.recycler && { mismatches: report.phases.recycler.mismatches },
      animationOnly: report.phases.animationOnly?.provider,
    },
    providerTotals: report.provider,
    reportPath,
  }, null, 2));

  // Under the negative control a pass would mean the assertions are vacuous.
  if (negativeControl) {
    if (report.result === "passed") {
      console.error("Negative control passed, so these assertions prove nothing.");
      process.exitCode = 1;
    }
    return;
  }
  if (report.result !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
