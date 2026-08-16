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
import { findChrome } from "./chrome.mjs";

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
  お問い合わせ: { en: "Contact", vi: "Liên hệ" },
  会社名: { en: "Company name", vi: "Tên công ty" },
  担当者名: { en: "Contact person", vi: "Người phụ trách" },
  送信: { en: "Send", vi: "Gửi" },
  "株式会社◯◯◯◯◯": { en: "Example Co., Ltd.", vi: "Công ty TNHH ABC" },
  "山田 太郎": { en: "Taro Yamada", vi: "Nguyễn Văn A" },
  会社のロゴ: { en: "Company logo", vi: "Logo công ty" },
  送信の確認: { en: "Confirm before sending", vi: "Xác nhận trước khi gửi" },
  部品一覧: { en: "Components", vi: "Thành phần" },
  部品の見出し: { en: "Component heading", vi: "Tiêu đề thành phần" },
  入れ子の部品: { en: "Nested component", vi: "Thành phần lồng nhau" },
  部品の説明: { en: "About this component", vi: "Giới thiệu thành phần" },
  後から追加: { en: "Added later", vi: "Thêm sau" },
  閉じた部品: { en: "Closed component", vi: "Thành phần đóng" },
  枠つき内容: { en: "Framed content", vi: "Nội dung trong khung" },
  枠内の見出し: { en: "Heading inside the frame", vi: "Tiêu đề trong khung" },
  枠内の本文: { en: "Body text inside the frame", vi: "Nội dung trong khung" },
  枠内の入力欄: { en: "Field inside the frame", vi: "Ô nhập trong khung" },
  操作で開く内容: { en: "Opened by the reader", vi: "Mở khi người dùng thao tác" },
  確認画面を開く: { en: "Open the confirmation", vi: "Mở màn xác nhận" },
  補足を開く: { en: "Open the note", vi: "Mở ghi chú" },
  メニューを開く: { en: "Open the menu", vi: "Mở menu" },
  確認画面の本文: { en: "Confirmation body text", vi: "Nội dung màn xác nhận" },
  補足の本文: { en: "Note body text", vi: "Nội dung ghi chú" },
  メニューの本文: { en: "Menu body text", vi: "Nội dung menu" },
  閉じる: { en: "Close", vi: "Đóng" },
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
        ...(process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
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

    // 1b. Strings that live in attributes rather than text nodes.
    const attributeMark = mark();
    const readAttributes = () => page.evaluate(() => ({
      companyPlaceholder: document.querySelector("#company")?.getAttribute("placeholder") ?? null,
      personPlaceholder: document.querySelector("#person")?.getAttribute("placeholder") ?? null,
      logoAlt: document.querySelector(".form-mark")?.getAttribute("alt") ?? null,
      buttonTitle: document.querySelector(".contact-form button")?.getAttribute("title") ?? null,
    }));
    const attributeDeadline = Date.now() + 20_000;
    let attributes = await readAttributes();
    while (Date.now() < attributeDeadline) {
      attributes = await readAttributes();
      if (!Object.values(attributes).some((value) => JAPANESE.test(value ?? ""))) break;
      await sleep(300);
    }
    check(
      "form placeholders are translated",
      attributes.companyPlaceholder === expectation("株式会社◯◯◯◯◯", "en")
        && attributes.personPlaceholder === expectation("山田 太郎", "en"),
      JSON.stringify(attributes),
    );
    check("image alt text is translated", attributes.logoAlt === expectation("会社のロゴ", "en"), attributes.logoAlt);
    check("page-owned title is translated", attributes.buttonTitle === expectation("送信の確認", "en"), attributes.buttonTitle);
    report.phases.attributes = { provider: since(attributeMark), values: attributes };

    // 1c. Text behind a shadow boundary, including a nested component, slotted
    // light DOM, and content the component adds after its first render.
    const shadowMark = mark();
    const readShadow = () => page.evaluate(() => {
      const card = document.querySelector("[data-probe='shadow-open']");
      const shadow = card?.shadowRoot ?? null;
      const nested = shadow?.querySelector("jp-badge")?.shadowRoot ?? null;
      const closed = document.querySelector("[data-probe='shadow-closed']");
      return {
        openReachable: Boolean(shadow),
        heading: shadow?.querySelector("[data-probe='shadow-heading']")?.textContent?.trim() ?? null,
        action: shadow?.querySelector("[data-probe='shadow-action']")?.textContent?.trim() ?? null,
        actionTitle: shadow?.querySelector("[data-probe='shadow-action']")?.getAttribute("title") ?? null,
        nested: nested?.querySelector("[data-probe='shadow-nested']")?.textContent?.trim() ?? null,
        later: shadow?.querySelector("[data-probe='shadow-later']")?.textContent?.trim() ?? null,
        slotted: card?.querySelector("[slot='note']")?.textContent?.trim() ?? null,
        closedReachable: Boolean(closed?.shadowRoot),
        closedText: closed?.textContent?.trim() ?? "",
      };
    });
    const shadowDeadline = Date.now() + 25_000;
    let shadow = await readShadow();
    while (Date.now() < shadowDeadline) {
      shadow = await readShadow();
      if (shadow.heading && shadow.nested && shadow.later
        && ![shadow.heading, shadow.action, shadow.actionTitle, shadow.nested, shadow.later, shadow.slotted]
          .some((value) => JAPANESE.test(value ?? ""))) break;
      await sleep(400);
    }
    check("text inside an open shadow root is translated", shadow.heading === expectation("部品の見出し", "en"), shadow.heading);
    check("nested shadow roots are reached too", shadow.nested === expectation("入れ子の部品", "en"), shadow.nested);
    check("attributes inside a shadow root are translated", shadow.actionTitle === expectation("部品の説明", "en"), shadow.actionTitle);
    check("slotted light DOM is translated", shadow.slotted === expectation("補足説明", "en"), shadow.slotted);
    check(
      "content a component adds after first render is translated",
      shadow.later === expectation("後から追加", "en"),
      shadow.later,
    );
    // Recorded as a platform limit rather than a bug: a closed root exposes no
    // shadowRoot, so its text cannot be reached by anything, including us.
    check("a closed shadow root stays unreachable", shadow.closedReachable === false, String(shadow.closedReachable));
    report.phases.shadow = { provider: since(shadowMark), values: shadow };

    // 1d. A same-origin frame, which is its own document with its own DOM.
    const frameMark = mark();
    const readFrame = async () => {
      const frame = page.frames().find((candidate) => candidate.url().endsWith("dynamic-frame.html"));
      if (!frame) return { present: false };
      return {
        present: true,
        heading: await frame.evaluate(() =>
          document.querySelector("[data-probe='frame-heading']")?.textContent?.trim() ?? null).catch(() => null),
        body: await frame.evaluate(() =>
          document.querySelector("[data-probe='frame-body']")?.textContent?.trim() ?? null).catch(() => null),
        placeholder: await frame.evaluate(() =>
          document.querySelector("[data-probe='frame-input']")?.getAttribute("placeholder") ?? null).catch(() => null),
      };
    };
    const frameDeadline = Date.now() + 25_000;
    let frameValues = await readFrame();
    while (Date.now() < frameDeadline) {
      frameValues = await readFrame();
      if (frameValues.present
        && ![frameValues.heading, frameValues.body, frameValues.placeholder]
          .some((value) => value === null || JAPANESE.test(value))) break;
      await sleep(400);
    }
    check("the same-origin frame is reachable", frameValues.present === true);
    check(
      "text inside a same-origin frame is translated",
      frameValues.heading === expectation("枠内の見出し", "en") && frameValues.body === expectation("枠内の本文", "en"),
      JSON.stringify(frameValues),
    );
    check(
      "attributes inside a frame are translated",
      frameValues.placeholder === expectation("枠内の入力欄", "en"),
      frameValues.placeholder,
    );
    // The popup shows one number for a page the reader sees as one page.
    const aggregated = await popup.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      return { status: response?.state?.status ?? null, translatedAnchors: response?.state?.translatedAnchors ?? 0 };
    });
    check(
      "the popup counts anchors from every frame",
      aggregated.translatedAnchors > 0,
      JSON.stringify(aggregated),
    );
    report.phases.frame = { provider: since(frameMark), values: frameValues, aggregated };

    // 1e. Content that only becomes visible when the reader acts. Each target
    // opens a different way and none of them changes text or child lists, so
    // this is where a change-driven engine is most likely to see nothing.
    // Stop the page's own churn first. With a ticker running, any rescan it
    // triggers would pick the revealed content up as a side effect, and this
    // phase would pass without proving the reveal itself was noticed.
    await page.evaluate(() => window.dynamicFixture.stopTextTimers());
    await sleep(SETTLE_MS * 2);
    const revealMark = mark();
    const reveals = [
      { name: "dialog", source: "確認画面の本文", probe: "dialog-body" },
      { name: "popover", source: "補足の本文", probe: "popover-body" },
      { name: "menu", source: "メニューの本文", probe: "menu-body" },
    ];
    const revealResults = {};
    for (const reveal of reveals) {
      await page.click(`[data-open='${reveal.name}']`);
      const deadline = Date.now() + 12_000;
      let shown = null;
      while (Date.now() < deadline) {
        shown = await page.evaluate((probe) =>
          document.querySelector(`[data-probe='${probe}']`)?.textContent?.trim() ?? null, reveal.probe);
        if (shown === expectation(reveal.source, "en")) break;
        await sleep(300);
      }
      revealResults[reveal.name] = shown;
      check(
        `content revealed by ${reveal.name} is translated`,
        shown === expectation(reveal.source, "en"),
        `saw ${JSON.stringify(shown)}`,
      );
      // A modal dialog covers the controls behind it, so the next reveal cannot
      // be opened until this one is closed.
      if (reveal.name === "dialog") {
        await page.evaluate(() => document.querySelector("[data-reveal='dialog']")?.close());
      }
    }
    report.phases.reveal = { provider: since(revealMark), values: revealResults };
    await page.evaluate(() => window.dynamicFixture.startTextTimers());

    // 1f. A string the data boundary protects. It must stay on the device, and
    // it must not cost the reader the rest of the page.
    const protectedText = await page.evaluate(() =>
      document.querySelector("[data-probe='protected']")?.textContent?.trim() ?? null);
    const protectedState = await popup.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
      return { withheld: response?.state?.withheldAnchors ?? 0, status: response?.state?.status ?? null };
    });
    check(
      "a protected string is never translated",
      protectedText === "パスワードは絶対に共有しないでください",
      String(protectedText),
    );
    check("withheld strings are reported, not silently dropped", protectedState.withheld > 0, JSON.stringify(protectedState));
    check("a protected string does not stop the rest of the page", protectedState.status !== "error", JSON.stringify(protectedState));
    report.phases.protected = { text: protectedText, state: protectedState };

    // 2. Content appended while scrolling.
    const scrollMark = mark();
    // Scroll until the page stops growing rather than a fixed number of steps,
    // since an endless feed makes the document taller as it is read.
    let previousOffset = -1;
    for (let step = 0; step < 40; step += 1) {
      const offset = await page.evaluate(() => {
        window.scrollBy({ top: 300, behavior: "instant" });
        return Math.round(window.scrollY);
      });
      await sleep(300);
      if (offset === previousOffset) break;
      previousOffset = offset;
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
      scrollDiagnostics: await page.evaluate(() => ({
        scrollY: Math.round(window.scrollY),
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        bodyOverflow: getComputedStyle(document.body).overflow,
        openDialogs: document.querySelectorAll("dialog[open]").length,
      })),
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
    const restoredAttributes = await readAttributes();
    check(
      "restore returns attribute values too",
      restoredAttributes.companyPlaceholder === "株式会社◯◯◯◯◯"
        && restoredAttributes.logoAlt === "会社のロゴ"
        && restoredAttributes.buttonTitle === "送信の確認",
      JSON.stringify(restoredAttributes),
    );
    report.phases.restore = { japaneseNodes: restoredJapanese, attributes: restoredAttributes };

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
