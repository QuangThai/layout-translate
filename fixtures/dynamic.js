// Page-owned behaviour for the dynamic fixture. Everything here is what an
// ordinary site does on its own: append on scroll, reveal on intersection,
// rewrite its own status text, recycle list rows, and animate.
//
// Timings are exposed so a runner can drive the page deterministically instead
// of sleeping and hoping.
(() => {
  const FEED_BATCH_SIZE = 4;
  const FEED_MAX_BATCHES = 3;
  const TICKER_INTERVAL_MS = 900;
  const RECYCLE_INTERVAL_MS = 1_200;

  const feedStrings = ["記事の見出し", "続きを読む", "新着", "詳細情報"];
  const tickerStrings = ["更新中", "完了しました", "処理中です"];
  const recycleStrings = ["新着", "完了しました", "詳細情報", "記事の見出し"];

  const state = {
    feedBatches: 0,
    tickerIndex: 0,
    recycleIndex: 0,
    deferredRevealed: false,
  };
  window.dynamicFixture = state;

  const feed = document.querySelector("[data-feed]");
  const sentinel = document.querySelector("[data-sentinel]");
  const feedStatus = document.querySelector("[data-feed-status]");
  const deferred = document.querySelector("[data-deferred]");
  const ticker = document.querySelector("[data-probe='ticker']");
  const rows = [...document.querySelectorAll(".recycler li")];

  function appendBatch() {
    if (state.feedBatches >= FEED_MAX_BATCHES) {
      feedStatus.textContent = "すべて表示しました";
      return;
    }
    const batch = state.feedBatches;
    for (let index = 0; index < FEED_BATCH_SIZE; index += 1) {
      const card = document.createElement("article");
      card.className = "feed-card";
      card.dataset.card = `${batch}-${index}`;
      const heading = document.createElement("h3");
      heading.textContent = feedStrings[index % feedStrings.length];
      const action = document.createElement("a");
      action.href = "#feed";
      action.className = "feed-action";
      action.textContent = "続きを読む";
      card.append(heading, action);
      feed.append(card);
    }
    state.feedBatches += 1;
    feedStatus.textContent = state.feedBatches >= FEED_MAX_BATCHES ? "すべて表示しました" : "読み込み中";
  }

  // Appends more content as the reader reaches the bottom, the way an endless
  // feed does.
  new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) appendBatch();
    }
  }, { rootMargin: "120px" }).observe(sentinel);

  // Fills a section only once it is actually revealed.
  new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || state.deferredRevealed) continue;
      state.deferredRevealed = true;
      const note = document.createElement("p");
      note.className = "deferred-note";
      note.dataset.probe = "deferred";
      note.textContent = "遅延セクション";
      deferred.append(note);
      observer.disconnect();
    }
  }, { rootMargin: "80px" }).observe(deferred);

  // A component that keeps its text behind an open shadow boundary, nests a
  // second component inside it, slots light-DOM content, and adds more text
  // later.
  class NestedBadge extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const shadow = this.attachShadow({ mode: "open" });
      const badge = document.createElement("span");
      badge.className = "nested-badge";
      badge.dataset.probe = "shadow-nested";
      badge.textContent = "入れ子の部品";
      shadow.append(badge);
    }
  }

  class JpCard extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const shadow = this.attachShadow({ mode: "open" });
      const heading = document.createElement("h3");
      heading.dataset.probe = "shadow-heading";
      heading.textContent = "部品の見出し";
      const action = document.createElement("button");
      action.type = "button";
      action.dataset.probe = "shadow-action";
      action.title = "部品の説明";
      action.textContent = "詳細情報";
      const nested = document.createElement("jp-badge");
      const slot = document.createElement("slot");
      slot.name = "note";
      shadow.append(heading, action, nested, slot);

      // Appears only after the first render, so it also proves the shadow root
      // is observed rather than merely walked once.
      setTimeout(() => {
        const later = document.createElement("p");
        later.dataset.probe = "shadow-later";
        later.textContent = "後から追加";
        shadow.append(later);
      }, 2_500);
    }
  }

  // Its text cannot be reached at all: a closed root exposes no shadowRoot.
  class JpClosed extends HTMLElement {
    connectedCallback() {
      const shadow = this.attachShadow({ mode: "closed" });
      const note = document.createElement("p");
      note.textContent = "閉じた部品";
      shadow.append(note);
    }
  }

  customElements.define("jp-badge", NestedBadge);
  customElements.define("jp-card", JpCard);
  customElements.define("jp-closed", JpClosed);

  const timers = [];

  function startTimers() {
    if (timers.length) return;
    // The page keeps ownership of this string and rewrites it on a timer.
    timers.push(setInterval(() => {
      state.tickerIndex = (state.tickerIndex + 1) % tickerStrings.length;
      ticker.textContent = tickerStrings[state.tickerIndex];
    }, TICKER_INTERVAL_MS));
    // Recycles existing rows instead of creating new ones.
    timers.push(setInterval(() => {
      state.recycleIndex += 1;
      rows.forEach((row, position) => {
        row.textContent = recycleStrings[(state.recycleIndex + position) % recycleStrings.length];
      });
    }, RECYCLE_INTERVAL_MS));
  }

  // Lets a runner separate text churn from pure animation: with the timers
  // stopped the CSS animation still runs, so any translation traffic in that
  // window came from the animation alone.
  state.stopTextTimers = () => {
    for (const timer of timers.splice(0)) clearInterval(timer);
  };
  state.startTextTimers = startTimers;
  state.currentTicker = () => tickerStrings[state.tickerIndex];
  state.currentRows = () => rows.map((row, position) =>
    recycleStrings[(state.recycleIndex + position) % recycleStrings.length]);

  startTimers();
})();
