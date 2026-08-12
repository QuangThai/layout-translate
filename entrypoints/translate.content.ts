import { browser } from "wxt/browser";
import { PageTranslationEngine } from "../src/content/translation-engine";
import type { ContentMessage, RuntimeMessage } from "../src/shared/contracts";

export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  runAt: "document_idle",
  main(ctx) {
    const engine = new PageTranslationEngine(document, (status, translatedAnchors, error) => {
      void browser.runtime.sendMessage({
        type: "CONTENT_STATUS",
        status,
        translatedAnchors,
        error,
      } satisfies RuntimeMessage).catch(() => undefined);
    });

    engine.start();
    browser.runtime.onMessage.addListener((message: ContentMessage) => {
      if (message.type === "CONTENT_COMMAND") engine.handleCommand(message.command);
    });
    void browser.runtime.sendMessage({ type: "CONTENT_READY" } satisfies RuntimeMessage);
    ctx.onInvalidated(() => engine.stop());
  },
});
