import { browser } from "wxt/browser";
import { PageTranslationEngine } from "../src/content/translation-engine";
import { MAX_TRANSLATION_BATCH_ITEMS, type ContentMessage, type RuntimeMessage, type TargetLanguage, type TranslationRequest, type TranslationResult, type RuntimeResponse } from "../src/shared/contracts";

export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  // A frame is a separate document with its own DOM, so an untranslated iframe
  // is a hole in the page that nothing reports. Each frame runs its own engine
  // and reports its own state; the background folds those into one.
  allFrames: true,
  runAt: "document_idle",
  main(ctx) {
    // On opt-in sites this file is injected programmatically, and the popup can
    // be opened again on an already-enabled tab. Injecting twice would start a
    // second engine over the same DOM, so the first one stays authoritative.
    const injectionFlag = "__layoutTranslateEngineActive";
    const world = globalThis as Record<string, unknown>;
    if (world[injectionFlag]) return;
    world[injectionFlag] = true;
    ctx.onInvalidated(() => {
      world[injectionFlag] = false;
    });

      const translateBatch = async (
        requests: TranslationRequest[],
        targetLanguage: TargetLanguage,
      ): Promise<TranslationResult[]> => {
        const translations: TranslationResult[] = [];
        for (let offset = 0; offset < requests.length; offset += MAX_TRANSLATION_BATCH_ITEMS) {
          const response = await browser.runtime.sendMessage({
            type: "TRANSLATE_BATCH",
            targetLanguage,
            requests: requests.slice(offset, offset + MAX_TRANSLATION_BATCH_ITEMS),
          } satisfies RuntimeMessage) as RuntimeResponse;
          if (response.type !== "TRANSLATION_RESULT") {
            throw new Error(response.type === "UNAVAILABLE" ? response.reason : "Translation backend returned no translations");
          }
          translations.push(...response.translations);
        }
        return translations;
      };

    const engine = new PageTranslationEngine(document, (status, translatedAnchors, error) => {
      void browser.runtime.sendMessage({
        type: "CONTENT_STATUS",
        status,
        translatedAnchors,
        withheldAnchors: engine.withheldAnchors,
        error,
      } satisfies RuntimeMessage).catch(() => undefined);
    }, translateBatch);

    engine.start();
    browser.runtime.onMessage.addListener((message: ContentMessage) => {
      if (message.type === "CONTENT_COMMAND") engine.handleCommand(message.command);
    });
    void browser.runtime.sendMessage({ type: "CONTENT_READY" } satisfies RuntimeMessage);
    ctx.onInvalidated(() => engine.stop());
  },
});
