import { browser } from "wxt/browser";
import {
  DEFAULT_EXTENSION_STATE,
  type BackendConfig,
  type ContentCommand,
  type ExtensionState,
  type RuntimeMessage,
  type RuntimeResponse,
} from "../src/shared/contracts";
import { translateViaBackend } from "../src/shared/backend-client";

const STORAGE_KEY = "layout-translate:state";
async function readBackendConfig(): Promise<BackendConfig> {
  const stored = await browser.storage.local.get("layout-translate:backend");
  const configured = stored["layout-translate:backend"] as Partial<BackendConfig> | undefined;
  const timeoutMs = typeof configured?.timeoutMs === "number" && Number.isFinite(configured.timeoutMs) && configured.timeoutMs > 0
    ? configured.timeoutMs
    : undefined;
  return {
    url: configured?.url ?? "",
    token: configured?.token ?? "",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

async function readState(): Promise<ExtensionState> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const state = stored[STORAGE_KEY] as Partial<ExtensionState> | undefined;
  return {
    ...DEFAULT_EXTENSION_STATE,
    ...state,
    targetLanguage: state?.targetLanguage === "vi" ? "vi" : "en",
    translatedAnchors: state?.translatedAnchors ?? 0,
  };
}

async function writeState(state: ExtensionState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: state });
}

async function sendToTab(tabId: number | undefined, command: ContentCommand): Promise<boolean> {
  if (tabId === undefined) return false;
  try {
    await browser.tabs.sendMessage(tabId, { type: "CONTENT_COMMAND", command });
    return true;
  } catch {
    return false;
  }
}

async function sendToActiveTab(command: ContentCommand): Promise<boolean> {
  const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  const activePage = tabs.find((tab) => /^https?:\/\//u.test(tab.url ?? ""));
  if (activePage?.id !== undefined) return sendToTab(activePage.id, command);

  // A real action popup does not become a browser tab, but automation can open
  // popup.html as a tab. In that case, keep targeting the nearest page in the
  // same window instead of sending a content command to the extension page.
  const windowTabs = await browser.tabs.query({ lastFocusedWindow: true });
  const pageTab = windowTabs.find((tab) => /^https?:\/\//u.test(tab.url ?? ""));
  return sendToTab(pageTab?.id, command);
}

async function handleMessage(
  message: RuntimeMessage,
  sender: { tab?: { id?: number; url?: string } },
): Promise<RuntimeResponse> {
  const state = await readState();

  switch (message.type) {
    case "GET_STATE":
      return { type: "STATE", state };
    case "TRANSLATE_BATCH": {
      try {
        const config = await readBackendConfig();
        const translations = await translateViaBackend(
          config,
          sender.tab?.url ? new URL(sender.tab.url).origin : "",
          message.requests,
          message.targetLanguage,
        );
        return { type: "TRANSLATION_RESULT", translations };
      } catch (error) {
        return {
          type: "UNAVAILABLE",
          state,
          reason: error instanceof Error ? error.message : "Translation backend request failed",
        };
      }
    }
    case "CONTENT_READY": {
      const delivered = await sendToTab(sender.tab?.id, { type: "SYNC_STATE", state });
      return { type: "ACK", state, delivered };
    }
    case "CONTENT_STATUS": {
      const nextState = {
        ...state,
        status: message.status,
        translatedAnchors: message.translatedAnchors,
        lastError: message.error,
      };
      await writeState(nextState);
      return { type: "ACK", state: nextState };
    }
    case "SET_ENABLED": {
      const nextState: ExtensionState = {
        ...state,
        enabled: message.enabled,
        status: message.enabled ? "scanning" : "inactive",
        lastError: undefined,
      };
      await writeState(nextState);
      const delivered = await sendToActiveTab({ type: "SET_ENABLED", enabled: message.enabled });
      return { type: delivered ? "ACK" : "UNAVAILABLE", state: nextState, ...(delivered ? {} : { reason: "No supported content script is connected" }) } as RuntimeResponse;
    }
    case "SET_TARGET_LANGUAGE": {
      const nextState: ExtensionState = {
        ...state,
        targetLanguage: message.targetLanguage,
        lastError: undefined,
      };
      await writeState(nextState);
      const delivered = await sendToActiveTab({ type: "SET_TARGET_LANGUAGE", targetLanguage: message.targetLanguage });
      return { type: delivered ? "ACK" : "UNAVAILABLE", state: nextState, ...(delivered ? {} : { reason: "No supported content script is connected" }) } as RuntimeResponse;
    }
    case "RESTORE_ORIGINAL": {
      const nextState: ExtensionState = {
        ...state,
        enabled: false,
        status: "restored",
        lastError: undefined,
      };
      await writeState(nextState);
      const delivered = await sendToActiveTab({ type: "RESTORE_ORIGINAL" });
      return { type: delivered ? "ACK" : "UNAVAILABLE", state: nextState, ...(delivered ? {} : { reason: "No supported content script is connected" }) } as RuntimeResponse;
    }
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void readState().then((state) => writeState(state));
  });
  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender) =>
    handleMessage(message, sender),
  );
});
